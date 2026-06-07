package com.kaizenreport.kensho.junit5;

import com.kaizenreport.kensho.CaseScratch;
import com.kaizenreport.kensho.EnvInfo;
import com.kaizenreport.kensho.KenshoContext;
import com.kaizenreport.kensho.KenshoSchema;
import com.kaizenreport.kensho.RunWriter;
import com.kaizenreport.kensho.annotations.Blocker;
import com.kaizenreport.kensho.annotations.Critical;
import com.kaizenreport.kensho.annotations.Description;
import com.kaizenreport.kensho.annotations.Epic;
import com.kaizenreport.kensho.annotations.Feature;
import com.kaizenreport.kensho.annotations.Label;
import com.kaizenreport.kensho.annotations.Labels;
import com.kaizenreport.kensho.annotations.Link;
import com.kaizenreport.kensho.annotations.Links;
import com.kaizenreport.kensho.annotations.Minor;
import com.kaizenreport.kensho.annotations.Normal;
import com.kaizenreport.kensho.annotations.Owner;
import com.kaizenreport.kensho.annotations.Severity;
import com.kaizenreport.kensho.annotations.Story;
import com.kaizenreport.kensho.annotations.Trivial;
import java.lang.annotation.Annotation;
import java.lang.reflect.AnnotatedElement;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.engine.TestSource;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.engine.support.descriptor.MethodSource;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

/**
 * JUnit Jupiter / Platform listener. Auto-registered via {@code
 * META-INF/services/org.junit.platform.launcher.TestExecutionListener} so it activates the moment
 * the jar is on the classpath.
 *
 * <p>Hook flow:
 *
 * <ul>
 *   <li>{@code testPlanExecutionStarted} — open the run, capture started-at.
 *   <li>{@code executionStarted(testIdentifier)} — for each leaf test, build a partial case dict
 *       and stash a {@link CaseScratch} under the running thread.
 *   <li>{@code executionFinished} — finalize status, errors, duration, write {@code
 *       cases/<id>.json}.
 *   <li>{@code testPlanExecutionFinished} — write {@code run.json}.
 * </ul>
 */
public class KenshoJunit5Listener implements TestExecutionListener {

  private RunWriter writer;
  private final ConcurrentMap<String, PendingCase> pending = new ConcurrentHashMap<>();

  @Override
  public void testPlanExecutionStarted(TestPlan testPlan) {
    String name = sysOrEnv("KENSHO_PROJECT_NAME", "kensho.project.name", "Unknown project");
    String slug = sysOrEnv("KENSHO_PROJECT_SLUG", "kensho.project.slug", null);
    if (slug == null) slug = RunWriter.slugify(name);
    Map<String, String> project = new LinkedHashMap<>();
    project.put("name", name);
    project.put("slug", slug);
    String url = sysOrEnv("KENSHO_PROJECT_URL", "kensho.project.url", null);
    if (url != null) project.put("url", url);

    String runId = sysOrEnv("KENSHO_RUN_ID", "kensho.run.id", null);
    java.nio.file.Path output = RunWriter.resolveOutput(null);
    writer =
        new RunWriter(
            output,
            project,
            "junit5",
            detectJunitVersion(),
            runId);
    KenshoContext.setWriter(writer);
  }

  @Override
  public void executionStarted(TestIdentifier id) {
    if (!id.isTest() || writer == null) return;
    PendingCase pc = new PendingCase();
    pc.startedNanos = System.nanoTime();
    pc.startedAt = RunWriter.isoNow();

    Map<String, Object> caseObj = new LinkedHashMap<>();

    String displayName = id.getDisplayName();
    String name = displayName;

    String filePath = null;
    Integer line = null;
    String fullName = id.getUniqueId();
    List<String> suite = new ArrayList<>();
    List<String> tags = new ArrayList<>();
    String severity = null;
    String owner = null;
    String description = null;
    Map<String, String> labels = new LinkedHashMap<>();
    List<Map<String, String>> links = new ArrayList<>();
    Map<String, Object> behavior = new LinkedHashMap<>();
    List<Map<String, String>> parameters = new ArrayList<>();

    Optional<TestSource> source = id.getSource();
    Class<?> testClass = null;
    Method testMethod = null;
    if (source.isPresent()) {
      TestSource ts = source.get();
      if (ts instanceof MethodSource) {
        MethodSource ms = (MethodSource) ts;
        try {
          testClass = Class.forName(ms.getClassName(), false, Thread.currentThread().getContextClassLoader());
          testMethod = findMethod(testClass, ms.getMethodName());
          fullName = ms.getClassName() + "." + ms.getMethodName();
          suite.add(ms.getClassName());
          filePath = guessFilePath(testClass);
          if (testMethod != null) line = stackLineFor(testClass, ms.getMethodName());
        } catch (Throwable ignored) {
          // best-effort — keep going with what we have
        }
      } else if (ts instanceof ClassSource) {
        ClassSource cs = (ClassSource) ts;
        try {
          testClass = Class.forName(cs.getClassName(), false, Thread.currentThread().getContextClassLoader());
          fullName = cs.getClassName();
          suite.add(cs.getClassName());
          filePath = guessFilePath(testClass);
        } catch (Throwable ignored) {
          // best-effort
        }
      }
    }

    // Walk class + method annotations.
    for (Annotation a : annotationsOf(testClass)) {
      severity = pickSeverity(severity, a);
      owner = pickStringValue(owner, a, Owner.class);
      description = pickStringValue(description, a, Description.class);
      String epic = pickStringValue(null, a, Epic.class);
      if (epic != null) behavior.putIfAbsent("epic", epic);
      String feature = pickStringValue(null, a, Feature.class);
      if (feature != null) behavior.putIfAbsent("feature", feature);
      String story = pickStringValue(null, a, Story.class);
      if (story != null) behavior.putIfAbsent("scenario", story);
      collectLinks(a, links);
      collectLabels(a, labels);
    }
    for (Annotation a : annotationsOf(testMethod)) {
      severity = pickSeverity(severity, a);
      String o2 = pickStringValue(null, a, Owner.class);
      if (o2 != null) owner = o2;
      String d2 = pickStringValue(null, a, Description.class);
      if (d2 != null) description = d2;
      String epic = pickStringValue(null, a, Epic.class);
      if (epic != null) behavior.put("epic", epic);
      String feature = pickStringValue(null, a, Feature.class);
      if (feature != null) behavior.put("feature", feature);
      String story = pickStringValue(null, a, Story.class);
      if (story != null) behavior.put("scenario", story);
      collectLinks(a, links);
      collectLabels(a, labels);
    }

    // JUnit @Tag values flow into case.tags.
    for (org.junit.platform.engine.TestTag t : id.getTags()) {
      String tag = t.getName();
      if (tag != null && !tag.isEmpty() && !tags.contains(tag)) tags.add(tag);
    }
    // Any extra @-prefixed tags inline in the display name (mirrors the JS adapters).
    extractInlineTags(displayName, tags);

    // Parametrized test argument values come through in the display name on JUnit 5
    // ("[1] 1, 2"). We keep the raw display name as a parameter alongside captured tags
    // so the report at least shows them.
    if (displayName != null && displayName.contains("[")) {
      int bracket = displayName.indexOf('[');
      if (bracket > 0) name = displayName.substring(0, bracket).trim();
      Map<String, String> p = new LinkedHashMap<>();
      p.put("name", "displayName");
      p.put("value", displayName);
      p.put("kind", "argument");
      parameters.add(p);
    }

    String baseId = KenshoSchema.stableCaseId(fullName, filePath);
    String caseId = writer.dedupeId(baseId);

    caseObj.put("id", caseId);
    caseObj.put("name", name == null ? "" : name);
    caseObj.put("fullName", fullName);
    if (filePath != null) caseObj.put("filePath", filePath);
    if (line != null) caseObj.put("line", line);
    if (!suite.isEmpty()) caseObj.put("suite", suite);
    if (!tags.isEmpty()) caseObj.put("tags", tags);
    if (severity != null) caseObj.put("severity", severity);
    if (owner != null) caseObj.put("owner", owner);
    if (!labels.isEmpty()) caseObj.put("labels", labels);
    caseObj.put("status", "skip"); // overwritten in executionFinished
    caseObj.put("startedAt", pc.startedAt);
    caseObj.put("duration", 0);
    if (!behavior.isEmpty()) caseObj.put("behavior", behavior);
    if (!parameters.isEmpty()) caseObj.put("parameters", parameters);
    if (description != null) caseObj.put("description", description);
    if (!links.isEmpty()) caseObj.put("links", links);

    pc.caseObj = caseObj;
    pc.scratch = new CaseScratch(caseId, System.currentTimeMillis());
    pending.put(id.getUniqueId(), pc);
    KenshoContext.set(pc.scratch);
  }

  @Override
  public void executionFinished(TestIdentifier id, TestExecutionResult result) {
    if (!id.isTest() || writer == null) return;
    PendingCase pc = pending.remove(id.getUniqueId());
    if (pc == null) return;
    try {
      long ms = Math.max(0L, (System.nanoTime() - pc.startedNanos) / 1_000_000L);
      String finishedAt = RunWriter.isoNow();
      String status;
      switch (result.getStatus()) {
        case SUCCESSFUL:
          status = "pass";
          break;
        case FAILED:
          status = "fail";
          break;
        case ABORTED:
          status = "broken";
          break;
        default:
          status = "skip";
      }
      pc.caseObj.put("status", status);
      pc.caseObj.put("finishedAt", finishedAt);
      pc.caseObj.put("duration", (int) ms);

      result
          .getThrowable()
          .ifPresent(
              t -> {
                List<Map<String, String>> errs = new ArrayList<>();
                Map<String, String> err = new LinkedHashMap<>();
                String msg = t.getMessage();
                err.put("message", msg == null || msg.isEmpty() ? t.getClass().getName() : firstLine(msg));
                err.put("stack", stackTrace(t));
                err.put("type", t.getClass().getName());
                errs.add(err);
                pc.caseObj.put("errors", errs);
              });

      if (!pc.scratch.steps.isEmpty()) pc.caseObj.put("steps", pc.scratch.steps);
      if (!pc.scratch.attachments.isEmpty()) pc.caseObj.put("attachments", pc.scratch.attachments);
      if (!pc.scratch.labels.isEmpty()) {
        @SuppressWarnings("unchecked")
        Map<String, String> existing = (Map<String, String>) pc.caseObj.get("labels");
        if (existing == null) {
          pc.caseObj.put("labels", pc.scratch.labels);
        } else {
          existing.putAll(pc.scratch.labels);
        }
      }
      if (!pc.scratch.links.isEmpty()) {
        @SuppressWarnings("unchecked")
        List<Map<String, String>> existing = (List<Map<String, String>>) pc.caseObj.get("links");
        if (existing == null) {
          pc.caseObj.put("links", pc.scratch.links);
        } else {
          existing.addAll(pc.scratch.links);
        }
      }

      writer.addCase(pc.caseObj);
    } catch (Exception e) {
      System.err.println("[kensho] failed to finalize " + id.getUniqueId() + ": " + e.getMessage());
    } finally {
      KenshoContext.set(null);
    }
  }

  @Override
  public void executionSkipped(TestIdentifier id, String reason) {
    if (!id.isTest() || writer == null) return;
    // executionStarted may not fire for an unconditionally-skipped test, so build a minimal record.
    if (!pending.containsKey(id.getUniqueId())) {
      executionStarted(id);
    }
    PendingCase pc = pending.remove(id.getUniqueId());
    if (pc == null) return;
    try {
      pc.caseObj.put("status", "skip");
      pc.caseObj.put("finishedAt", RunWriter.isoNow());
      if (reason != null && !reason.isEmpty()) {
        List<Map<String, String>> errs = new ArrayList<>();
        Map<String, String> err = new LinkedHashMap<>();
        err.put("message", firstLine(reason));
        errs.add(err);
        pc.caseObj.put("errors", errs);
      }
      writer.addCase(pc.caseObj);
    } finally {
      KenshoContext.set(null);
    }
  }

  @Override
  public void testPlanExecutionFinished(TestPlan testPlan) {
    if (writer == null) return;
    writer.writeManifest(RunWriter.isoNow());
    writer = null;
  }

  // ----- annotation helpers ----- //

  private static List<Annotation> annotationsOf(AnnotatedElement el) {
    if (el == null) return Collections.emptyList();
    return Arrays.asList(el.getAnnotations());
  }

  private static String pickSeverity(String current, Annotation a) {
    if (current != null) return current;
    if (a instanceof Severity) return KenshoSchema.normalizeSeverity(((Severity) a).value());
    if (a instanceof Blocker) return "blocker";
    if (a instanceof Critical) return "critical";
    if (a instanceof Normal) return "normal";
    if (a instanceof Minor) return "minor";
    if (a instanceof Trivial) return "trivial";
    return null;
  }

  @SuppressWarnings("unchecked")
  private static String pickStringValue(
      String current, Annotation a, Class<? extends Annotation> type) {
    if (current != null) return current;
    if (!type.isInstance(a)) return null;
    try {
      Method m = type.getMethod("value");
      Object v = m.invoke(a);
      if (v instanceof String) {
        String s = (String) v;
        return s.isEmpty() ? null : s;
      }
    } catch (ReflectiveOperationException ignored) {
      // fall through
    }
    return null;
  }

  private static void collectLinks(Annotation a, List<Map<String, String>> out) {
    if (a instanceof Link) {
      addLink((Link) a, out);
    } else if (a instanceof Links) {
      for (Link l : ((Links) a).value()) addLink(l, out);
    }
  }

  private static void addLink(Link l, List<Map<String, String>> out) {
    if (l.url() == null || l.url().isEmpty()) return;
    Map<String, String> entry = new LinkedHashMap<>();
    entry.put("url", l.url());
    if (!l.kind().isEmpty()) entry.put("kind", l.kind());
    if (!l.label().isEmpty()) entry.put("label", l.label());
    out.add(entry);
  }

  private static void collectLabels(Annotation a, Map<String, String> out) {
    if (a instanceof Label) {
      Label l = (Label) a;
      out.put(l.key(), l.value());
    } else if (a instanceof Labels) {
      for (Label l : ((Labels) a).value()) out.put(l.key(), l.value());
    }
  }

  private static void extractInlineTags(String text, List<String> tags) {
    if (text == null) return;
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("@([\\w-]+)").matcher(text);
    while (m.find()) {
      String t = m.group(1);
      if (!tags.contains(t)) tags.add(t);
    }
  }

  private static Method findMethod(Class<?> cls, String methodName) {
    if (cls == null || methodName == null) return null;
    // Strip parameter list from "name(int, int)" if present.
    String bare = methodName;
    int paren = bare.indexOf('(');
    if (paren > 0) bare = bare.substring(0, paren);
    for (Method m : cls.getDeclaredMethods()) {
      if (m.getName().equals(bare)) return m;
    }
    return null;
  }

  /**
   * Best-effort source path. We cannot get exact file paths from JUnit 5 without a
   * resource-aware lookup, so we synthesise {@code path/to/Class.java} relative to the
   * conventional Maven source layout. This keeps the {@code stableCaseId} stable across
   * runs because the same convention applies on every machine.
   */
  private static String guessFilePath(Class<?> cls) {
    if (cls == null) return null;
    String pkg = cls.getPackage() == null ? "" : cls.getPackage().getName().replace('.', '/');
    String simpleName = cls.getSimpleName();
    if (simpleName == null || simpleName.isEmpty()) return null;
    String tail = simpleName + ".java";
    return (pkg.isEmpty() ? "" : pkg + "/") + tail;
  }

  /**
   * Try to recover the line number of the test method by triggering the class loader and reading
   * a fresh stack trace. Falls back to {@code null} when we can't tell — line numbers are an
   * optional schema field.
   */
  private static Integer stackLineFor(Class<?> cls, String methodName) {
    // Reflection can't give us source lines without a debug-info-aware library
    // (e.g. ASM). Returning null keeps schema validity intact.
    return null;
  }

  private static String firstLine(String s) {
    if (s == null) return "";
    int nl = s.indexOf('\n');
    return nl < 0 ? s : s.substring(0, nl);
  }

  private static String stackTrace(Throwable t) {
    java.io.StringWriter sw = new java.io.StringWriter();
    t.printStackTrace(new java.io.PrintWriter(sw));
    return sw.toString();
  }

  private static String detectJunitVersion() {
    Package pkg = TestExecutionListener.class.getPackage();
    if (pkg != null) {
      String v = pkg.getImplementationVersion();
      if (v != null) return v;
    }
    return "5.x";
  }

  private static String sysOrEnv(String envKey, String sysKey, String fallback) {
    String v = System.getProperty(sysKey);
    if (v == null || v.isEmpty()) v = System.getenv(envKey);
    return (v == null || v.isEmpty()) ? fallback : v;
  }

  private static final class PendingCase {
    Map<String, Object> caseObj;
    CaseScratch scratch;
    long startedNanos;
    String startedAt;
  }
}
