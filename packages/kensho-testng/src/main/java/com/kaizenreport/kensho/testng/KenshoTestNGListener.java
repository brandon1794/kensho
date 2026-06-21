package com.kaizenreport.kensho.testng;

import com.kaizenreport.kensho.CaseScratch;
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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.testng.IInvokedMethod;
import org.testng.IInvokedMethodListener;
import org.testng.ISuite;
import org.testng.ISuiteListener;
import org.testng.ITestContext;
import org.testng.ITestListener;
import org.testng.ITestResult;

/**
 * TestNG reporter. Auto-registered via {@code
 * META-INF/services/org.testng.ITestNGListener}; nothing to wire up in the test config.
 *
 * <p>Hook flow:
 *
 * <ul>
 *   <li>{@link #onStart(ISuite)} (first suite that fires) — open the run.
 *   <li>{@link #onTestStart} — build a partial case dict, stash {@link CaseScratch}.
 *   <li>{@link #onTestSuccess} / {@link #onTestFailure} / {@link #onTestSkipped} / {@link
 *       #onTestFailedButWithinSuccessPercentage} — finalize, write {@code cases/<id>.json}.
 *   <li>{@link #onFinish(ISuite)} (last suite) — write {@code run.json}.
 * </ul>
 *
 * <p>Severity is sourced (in priority order) from the {@code @Severity}/shorthand annotation, then
 * from any {@code @Test(groups={...})} group whose name matches one of the Kensho severity values.
 */
public class KenshoTestNGListener
    implements ITestListener, ISuiteListener, IInvokedMethodListener {

  private final Object lock = new Object();
  private RunWriter writer;
  private int activeSuites = 0;
  private final ConcurrentMap<String, PendingCase> pending = new ConcurrentHashMap<>();

  @Override
  public void onStart(ISuite suite) {
    synchronized (lock) {
      activeSuites++;
      if (writer != null) return;
      String name = sysOrEnv("KENSHO_PROJECT_NAME", "kensho.project.name", null);
      if (name == null) name = suite.getName();
      if (name == null || name.isEmpty()) name = "Unknown project";
      String slug = sysOrEnv("KENSHO_PROJECT_SLUG", "kensho.project.slug", null);
      if (slug == null) slug = RunWriter.slugify(name);
      Map<String, String> project = new LinkedHashMap<>();
      project.put("name", name);
      project.put("slug", slug);
      String url = sysOrEnv("KENSHO_PROJECT_URL", "kensho.project.url", null);
      if (url != null) project.put("url", url);

      String runId = sysOrEnv("KENSHO_RUN_ID", "kensho.run.id", null);
      writer =
          new RunWriter(
              RunWriter.resolveOutput(null), project, "testng", detectTestngVersion(), runId);
      KenshoContext.setWriter(writer);
    }
  }

  @Override
  public void onFinish(ISuite suite) {
    RunWriter w;
    synchronized (lock) {
      activeSuites = Math.max(0, activeSuites - 1);
      if (activeSuites > 0 || writer == null) return;
      w = writer;
      writer = null;
    }
    w.writeManifest(RunWriter.isoNow());
  }

  @Override
  public void onTestStart(ITestResult result) {
    if (writer == null) return;
    PendingCase pc = new PendingCase();
    pc.startedNanos = System.nanoTime();
    pc.startedAt = RunWriter.isoNow();

    Method method = result.getMethod().getConstructorOrMethod().getMethod();
    Class<?> testClass =
        method != null
            ? method.getDeclaringClass()
            : result.getTestClass().getRealClass();

    String fullName = testClass.getName() + "." + result.getName();
    String filePath = guessFilePath(testClass);

    Map<String, Object> caseObj = new LinkedHashMap<>();
    List<String> suite = new ArrayList<>();
    suite.add(testClass.getName());
    List<String> tags = new ArrayList<>();
    String severity = null;
    String owner = null;
    String description = null;
    Map<String, String> labels = new LinkedHashMap<>();
    List<Map<String, String>> links = new ArrayList<>();
    Map<String, Object> behavior = new LinkedHashMap<>();
    List<Map<String, String>> parameters = new ArrayList<>();

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
    if (method != null) {
      for (Annotation a : annotationsOf(method)) {
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
    }

    String[] groups = result.getMethod().getGroups();
    if (groups != null) {
      for (String g : groups) {
        if (g == null || g.isEmpty()) continue;
        String norm = KenshoSchema.normalizeSeverity(g);
        if (norm != null) {
          if (severity == null) severity = norm;
          continue; // severity-as-group: don't double-publish into tags
        }
        if (!tags.contains(g)) tags.add(g);
      }
    }

    Object[] params = result.getParameters();
    if (params != null && params.length > 0) {
      for (int i = 0; i < params.length; i++) {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("name", "arg" + i);
        p.put("value", String.valueOf(params[i]));
        p.put("kind", "argument");
        parameters.add(p);
      }
    }

    String baseId = KenshoSchema.stableCaseId(fullName, filePath);
    String caseId = writer.dedupeId(baseId);

    caseObj.put("id", caseId);
    caseObj.put("name", result.getName());
    caseObj.put("fullName", fullName);
    if (filePath != null) caseObj.put("filePath", filePath);
    caseObj.put("suite", suite);
    if (!tags.isEmpty()) caseObj.put("tags", tags);
    if (severity != null) caseObj.put("severity", severity);
    if (owner != null) caseObj.put("owner", owner);
    if (!labels.isEmpty()) caseObj.put("labels", labels);
    caseObj.put("status", "skip");
    caseObj.put("startedAt", pc.startedAt);
    caseObj.put("duration", 0);
    if (!behavior.isEmpty()) caseObj.put("behavior", behavior);
    if (!parameters.isEmpty()) caseObj.put("parameters", parameters);
    if (description != null) caseObj.put("description", description);
    if (!links.isEmpty()) caseObj.put("links", links);

    pc.caseObj = caseObj;
    pc.scratch = new CaseScratch(caseId, System.currentTimeMillis());
    pending.put(keyFor(result), pc);
    KenshoContext.set(pc.scratch);
  }

  @Override
  public void onTestSuccess(ITestResult r) {
    finalize(r, "pass");
  }

  @Override
  public void onTestFailure(ITestResult r) {
    finalize(r, "fail");
  }

  @Override
  public void onTestSkipped(ITestResult r) {
    finalize(r, "skip");
  }

  @Override
  public void onTestFailedButWithinSuccessPercentage(ITestResult r) {
    finalize(r, "broken");
  }

  @Override
  public void onTestFailedWithTimeout(ITestResult r) {
    finalize(r, "fail");
  }

  private void finalize(ITestResult r, String status) {
    if (writer == null) return;
    PendingCase pc = pending.remove(keyFor(r));
    if (pc == null) {
      // onTestSkipped can fire without onTestStart for skipped-by-config tests.
      onTestStart(r);
      pc = pending.remove(keyFor(r));
      if (pc == null) return;
    }
    try {
      long ms = Math.max(0L, r.getEndMillis() - r.getStartMillis());
      if (ms == 0) ms = Math.max(0L, (System.nanoTime() - pc.startedNanos) / 1_000_000L);
      pc.caseObj.put("status", status);
      pc.caseObj.put("finishedAt", RunWriter.isoNow());
      pc.caseObj.put("duration", (int) ms);
      Throwable t = r.getThrowable();
      if (t != null) {
        List<Map<String, String>> errs = new ArrayList<>();
        Map<String, String> err = new LinkedHashMap<>();
        String msg = t.getMessage();
        err.put("message", msg == null || msg.isEmpty() ? t.getClass().getName() : firstLine(msg));
        err.put("stack", stackTrace(t));
        err.put("type", t.getClass().getName());
        errs.add(err);
        pc.caseObj.put("errors", errs);
      }
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
      mergeScratchMetadata(pc.caseObj, pc.scratch);
      writer.addCase(pc.caseObj);
    } finally {
      KenshoContext.set(null);
    }
  }

  @Override
  public void onStart(ITestContext ctx) {
    /* no-op — onStart(ISuite) handles run-level init */
  }

  @Override
  public void onFinish(ITestContext ctx) {
    /* no-op — onFinish(ISuite) handles flush */
  }

  // ----- helpers ----- //

  private static String keyFor(ITestResult r) {
    return r.getTestClass().getName()
        + "."
        + r.getName()
        + "@"
        + System.identityHashCode(r);
  }

  /**
   * Merge runtime metadata captured via the {@link com.kaizenreport.kensho.Kensho} static API
   * (behavior/severity/owner/description/tags/parameters/flaky/muted) into the case object. Runtime
   * values supplement annotation-derived values; for scalar fields the runtime call wins.
   */
  @SuppressWarnings("unchecked")
  static void mergeScratchMetadata(Map<String, Object> caseObj, CaseScratch scratch) {
    if (scratch == null) return;

    if (!scratch.behavior.isEmpty()) {
      Map<String, Object> existing = (Map<String, Object>) caseObj.get("behavior");
      if (existing == null) {
        caseObj.put("behavior", new LinkedHashMap<>(scratch.behavior));
      } else {
        existing.putAll(scratch.behavior);
      }
    }

    if (scratch.severity != null) caseObj.put("severity", scratch.severity);
    if (scratch.owner != null) caseObj.put("owner", scratch.owner);
    if (scratch.description != null) caseObj.put("description", scratch.description);

    if (!scratch.tags.isEmpty()) {
      List<String> existing = (List<String>) caseObj.get("tags");
      if (existing == null) {
        caseObj.put("tags", new ArrayList<>(scratch.tags));
      } else {
        for (String t : scratch.tags) if (!existing.contains(t)) existing.add(t);
      }
    }

    if (!scratch.parameters.isEmpty()) {
      List<Map<String, String>> existing = (List<Map<String, String>>) caseObj.get("parameters");
      if (existing == null) {
        caseObj.put("parameters", new ArrayList<>(scratch.parameters));
      } else {
        existing.addAll(scratch.parameters);
      }
    }

    if (scratch.flaky) caseObj.put("flaky", true);
    if (scratch.muted) caseObj.put("muted", true);
  }

  private static List<Annotation> annotationsOf(AnnotatedElement el) {
    if (el == null) return java.util.Collections.emptyList();
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
    if (a instanceof Link) addLink((Link) a, out);
    else if (a instanceof Links) for (Link l : ((Links) a).value()) addLink(l, out);
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

  private static String guessFilePath(Class<?> cls) {
    if (cls == null) return null;
    String pkg = cls.getPackage() == null ? "" : cls.getPackage().getName().replace('.', '/');
    String simpleName = cls.getSimpleName();
    if (simpleName == null || simpleName.isEmpty()) return null;
    return (pkg.isEmpty() ? "" : pkg + "/") + simpleName + ".java";
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

  private static String detectTestngVersion() {
    Package pkg = ITestListener.class.getPackage();
    if (pkg != null) {
      String v = pkg.getImplementationVersion();
      if (v != null) return v;
    }
    return "7.x";
  }

  private static String sysOrEnv(String envKey, String sysKey, String fallback) {
    String v = System.getProperty(sysKey);
    if (v == null || v.isEmpty()) v = System.getenv(envKey);
    return (v == null || v.isEmpty()) ? fallback : v;
  }

  @Override
  public void beforeInvocation(IInvokedMethod method, ITestResult testResult) {
    /* no-op — TestListener hooks already cover the lifecycle */
  }

  @Override
  public void afterInvocation(IInvokedMethod method, ITestResult testResult) {
    /* no-op */
  }

  private static final class PendingCase {
    Map<String, Object> caseObj;
    CaseScratch scratch;
    long startedNanos;
    String startedAt;
  }
}
