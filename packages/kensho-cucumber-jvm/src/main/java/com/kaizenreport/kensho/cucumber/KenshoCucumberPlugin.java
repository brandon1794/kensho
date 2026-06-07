package com.kaizenreport.kensho.cucumber;

import com.kaizenreport.kensho.CaseScratch;
import com.kaizenreport.kensho.KenshoContext;
import com.kaizenreport.kensho.KenshoSchema;
import com.kaizenreport.kensho.RunWriter;
import io.cucumber.plugin.ConcurrentEventListener;
import io.cucumber.plugin.event.DataTableArgument;
import io.cucumber.plugin.event.EmbedEvent;
import io.cucumber.plugin.event.EventPublisher;
import io.cucumber.plugin.event.PickleStepTestStep;
import io.cucumber.plugin.event.Result;
import io.cucumber.plugin.event.Status;
import io.cucumber.plugin.event.TestCase;
import io.cucumber.plugin.event.TestCaseFinished;
import io.cucumber.plugin.event.TestCaseStarted;
import io.cucumber.plugin.event.TestRunFinished;
import io.cucumber.plugin.event.TestRunStarted;
import io.cucumber.plugin.event.TestStep;
import io.cucumber.plugin.event.TestStepFinished;
import io.cucumber.plugin.event.WriteEvent;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Cucumber-JVM 7.x plugin. Implements {@link ConcurrentEventListener} so it works under parallel
 * scenario execution.
 *
 * <p>Auto-registered through Cucumber's plugin SPI ({@code
 * META-INF/services/io.cucumber.plugin.Plugin}) — installing the dependency is enough.
 *
 * <p>Each scenario maps to one Kensho case. Each step (Given/When/Then) maps to one Kensho step,
 * with the gherkin keyword carried in the step title. Step arguments (`DataTable` rows or `DocString`
 * payloads) are captured in {@code step.parameters[]}. {@code Scenario.attach()} calls flow through
 * the cucumber {@code EmbedEvent} into {@code case.attachments[]}.
 */
public class KenshoCucumberPlugin implements ConcurrentEventListener {

  private RunWriter writer;
  private final ConcurrentMap<URI, String> featureNames = new ConcurrentHashMap<>();
  private final Map<UUID, ScenarioCtx> openCases = new ConcurrentHashMap<>();

  @Override
  public void setEventPublisher(EventPublisher publisher) {
    publisher.registerHandlerFor(TestRunStarted.class, this::onRunStarted);
    publisher.registerHandlerFor(TestCaseStarted.class, this::onCaseStarted);
    publisher.registerHandlerFor(TestStepFinished.class, this::onStepFinished);
    publisher.registerHandlerFor(EmbedEvent.class, this::onEmbed);
    publisher.registerHandlerFor(WriteEvent.class, this::onWrite);
    publisher.registerHandlerFor(TestCaseFinished.class, this::onCaseFinished);
    publisher.registerHandlerFor(TestRunFinished.class, this::onRunFinished);
  }

  // ----- run lifecycle ----- //

  private void onRunStarted(TestRunStarted ev) {
    String name = sysOrEnv("KENSHO_PROJECT_NAME", "kensho.project.name", "Unknown project");
    String slug = sysOrEnv("KENSHO_PROJECT_SLUG", "kensho.project.slug", null);
    if (slug == null) slug = RunWriter.slugify(name);
    Map<String, String> project = new LinkedHashMap<>();
    project.put("name", name);
    project.put("slug", slug);
    String url = sysOrEnv("KENSHO_PROJECT_URL", "kensho.project.url", null);
    if (url != null) project.put("url", url);
    String runId = sysOrEnv("KENSHO_RUN_ID", "kensho.run.id", null);

    // The schema only enumerates "cucumber-js" for cucumber implementations; we report under
    // that name so the run is accepted by `kensho validate` until the schema gains an explicit
    // "cucumber-jvm" entry. The framework.version is enough to disambiguate downstream.
    writer =
        new RunWriter(
            RunWriter.resolveOutput(null),
            project,
            "cucumber-js",
            detectCucumberVersion(),
            runId);
    KenshoContext.setWriter(writer);
  }

  private void onRunFinished(TestRunFinished ev) {
    if (writer == null) return;
    writer.writeManifest(RunWriter.isoNow());
    writer = null;
  }

  // ----- per-scenario lifecycle ----- //

  private void onCaseStarted(TestCaseStarted ev) {
    if (writer == null) return;
    TestCase tc = ev.getTestCase();
    String featureName = featureFromUri(tc.getUri());
    String filePath = relativiseUri(tc.getUri());
    String scenarioName = tc.getName();
    String fullName = (featureName.isEmpty() ? "" : featureName + " > ") + scenarioName;

    ScenarioCtx ctx = new ScenarioCtx();
    ctx.featureName = featureName;
    ctx.scenarioName = scenarioName;
    ctx.filePath = filePath;
    ctx.line = tc.getLocation() == null ? null : tc.getLocation().getLine();
    ctx.startedNanos = System.nanoTime();
    ctx.startedAt = RunWriter.isoNow();
    ctx.fullName = fullName;

    String baseId = KenshoSchema.stableCaseId(fullName, filePath);
    ctx.caseId = writer.dedupeId(baseId);
    ctx.scratch = new CaseScratch(ctx.caseId, System.currentTimeMillis());

    List<String> tags = new ArrayList<>();
    String severity = null;
    for (String t : tc.getTags()) {
      String stripped = t.startsWith("@") ? t.substring(1) : t;
      String norm = KenshoSchema.normalizeSeverity(stripped);
      if (norm != null && severity == null) {
        severity = norm;
        continue; // severity tag — don't double-publish into tags
      }
      if (!tags.contains(stripped)) tags.add(stripped);
    }
    ctx.tags = tags;
    ctx.severity = severity;

    openCases.put(tc.getId(), ctx);
    KenshoContext.set(ctx.scratch);
  }

  private void onStepFinished(TestStepFinished ev) {
    if (writer == null) return;
    ScenarioCtx ctx = openCases.get(ev.getTestCase().getId());
    if (ctx == null) return;
    if (!(ev.getTestStep() instanceof PickleStepTestStep)) {
      // hooks (before/after) — record them as setup/teardown phase steps so they show up
      // in the report when they fail.
      Result r = ev.getResult();
      if (r.getStatus() != Status.PASSED && r.getStatus() != Status.UNUSED) {
        Map<String, Object> step = new LinkedHashMap<>();
        step.put("id", "step_" + shortId(8));
        step.put("title", "(hook) " + ev.getTestStep().getCodeLocation());
        step.put("status", mapStepStatus(r.getStatus()));
        step.put("startedAt", RunWriter.isoNow());
        step.put("duration", millisOfDuration(r));
        step.put("phase", "setup");
        ctx.steps.add(step);
        if (r.getError() != null && ctx.firstError == null) ctx.firstError = r.getError();
      }
      return;
    }
    PickleStepTestStep ps = (PickleStepTestStep) ev.getTestStep();
    Map<String, Object> step = new LinkedHashMap<>();
    step.put("id", "step_" + shortId(8));
    step.put("title", ps.getStep().getKeyword().trim() + " " + ps.getStep().getText());
    step.put("status", mapStepStatus(ev.getResult().getStatus()));
    step.put("startedAt", RunWriter.isoNow());
    step.put("duration", millisOfDuration(ev.getResult()));

    Object arg = ps.getStep().getArgument();
    if (arg instanceof DataTableArgument) {
      DataTableArgument dta = (DataTableArgument) arg;
      List<Map<String, String>> params = new ArrayList<>();
      List<List<String>> cells = dta.cells();
      for (int row = 0; row < cells.size(); row++) {
        List<String> r = cells.get(row);
        for (int col = 0; col < r.size(); col++) {
          Map<String, String> p = new LinkedHashMap<>();
          p.put("name", "row" + row + "/col" + col);
          p.put("value", r.get(col) == null ? "" : r.get(col));
          p.put("kind", "data-row");
          params.add(p);
        }
      }
      if (!params.isEmpty()) step.put("parameters", params);
    }

    String gherkinLine = ps.getStep().getKeyword().trim() + " " + ps.getStep().getText();
    ctx.gherkin.add(gherkinLine);
    ctx.steps.add(step);
    if (ev.getResult().getError() != null && ctx.firstError == null) {
      ctx.firstError = ev.getResult().getError();
    }
  }

  private void onEmbed(EmbedEvent ev) {
    // Cucumber's Scenario.attach() emits EmbedEvent — we materialize it as a
    // file under attachments/<caseId>/.
    if (writer == null) return;
    ScenarioCtx ctx = openCases.get(ev.getTestCase().getId());
    if (ctx == null) return;
    try {
      Path caseDir = writer.attachmentsDir.resolve(ctx.caseId);
      Files.createDirectories(caseDir);
      String mime = ev.getMediaType();
      String ext = extensionForMime(mime);
      String fileName = "att_" + shortId(8) + (ev.getName() != null ? "_" + safeName(ev.getName()) : "") + ext;
      Path dest = caseDir.resolve(fileName);
      Files.write(dest, ev.getData());
      Map<String, Object> rec = new LinkedHashMap<>();
      String id = "att_" + shortId(8);
      rec.put("id", id);
      rec.put("kind", kindForMime(mime));
      rec.put("relativePath", writer.outputDir.relativize(dest).toString().replace('\\', '/'));
      rec.put("mimeType", mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
      rec.put("sizeBytes", (int) Files.size(dest));
      ctx.attachments.add(rec);
    } catch (IOException e) {
      System.err.println("[kensho] cucumber attach failed: " + e.getMessage());
    }
  }

  private void onWrite(WriteEvent ev) {
    if (writer == null) return;
    ScenarioCtx ctx = openCases.get(ev.getTestCase().getId());
    if (ctx == null) return;
    Map<String, Object> log = new LinkedHashMap<>();
    long offset = Math.max(0L, (System.nanoTime() - ctx.startedNanos) / 1_000_000L);
    log.put("t", (int) offset);
    log.put("level", "info");
    log.put("msg", ev.getText() == null ? "" : ev.getText());
    ctx.logs.add(log);
  }

  private void onCaseFinished(TestCaseFinished ev) {
    if (writer == null) return;
    ScenarioCtx ctx = openCases.remove(ev.getTestCase().getId());
    if (ctx == null) return;
    try {
      String status = mapCaseStatus(ev.getResult().getStatus());
      String finishedAt = RunWriter.isoNow();
      long duration = Math.max(0L, (System.nanoTime() - ctx.startedNanos) / 1_000_000L);
      if (ev.getResult().getDuration() != null) {
        long fromCucumber = millisOfDuration(ev.getResult());
        if (fromCucumber > 0) duration = fromCucumber;
      }

      Map<String, Object> caseObj = new LinkedHashMap<>();
      caseObj.put("id", ctx.caseId);
      caseObj.put("name", ctx.scenarioName);
      caseObj.put("fullName", ctx.fullName);
      if (ctx.filePath != null) caseObj.put("filePath", ctx.filePath);
      if (ctx.line != null) caseObj.put("line", ctx.line);
      List<String> suite = new ArrayList<>();
      if (!ctx.featureName.isEmpty()) suite.add(ctx.featureName);
      if (!suite.isEmpty()) caseObj.put("suite", suite);
      if (!ctx.tags.isEmpty()) caseObj.put("tags", ctx.tags);
      if (ctx.severity != null) caseObj.put("severity", ctx.severity);
      caseObj.put("status", status);
      caseObj.put("startedAt", ctx.startedAt);
      caseObj.put("finishedAt", finishedAt);
      caseObj.put("duration", (int) duration);
      Map<String, Object> behavior = new LinkedHashMap<>();
      if (!ctx.featureName.isEmpty()) {
        behavior.put("epic", ctx.featureName);
        behavior.put("feature", ctx.featureName);
      }
      behavior.put("scenario", ctx.scenarioName);
      if (!ctx.gherkin.isEmpty()) behavior.put("gherkin", ctx.gherkin);
      caseObj.put("behavior", behavior);
      if (!ctx.steps.isEmpty()) caseObj.put("steps", ctx.steps);
      if (!ctx.attachments.isEmpty() || !ctx.scratch.attachments.isEmpty()) {
        List<Map<String, Object>> all = new ArrayList<>(ctx.attachments);
        all.addAll(ctx.scratch.attachments);
        caseObj.put("attachments", all);
      }
      if (!ctx.logs.isEmpty()) caseObj.put("logs", ctx.logs);
      if (!ctx.scratch.labels.isEmpty()) caseObj.put("labels", ctx.scratch.labels);
      if (!ctx.scratch.links.isEmpty()) caseObj.put("links", ctx.scratch.links);

      if (ctx.firstError != null) {
        List<Map<String, String>> errs = new ArrayList<>();
        Map<String, String> err = new LinkedHashMap<>();
        Throwable t = ctx.firstError;
        String msg = t.getMessage();
        err.put("message", msg == null || msg.isEmpty() ? t.getClass().getName() : firstLine(msg));
        err.put("stack", stackTrace(t));
        err.put("type", t.getClass().getName());
        errs.add(err);
        caseObj.put("errors", errs);
      }

      writer.addCase(caseObj);
    } finally {
      KenshoContext.set(null);
    }
  }

  // ----- helpers ----- //

  private String featureFromUri(URI uri) {
    if (uri == null) return "";
    return featureNames.computeIfAbsent(
        uri,
        u -> {
          String s = u.toString();
          int slash = s.lastIndexOf('/');
          String tail = slash < 0 ? s : s.substring(slash + 1);
          int dot = tail.lastIndexOf('.');
          return dot < 0 ? tail : tail.substring(0, dot);
        });
  }

  private String relativiseUri(URI uri) {
    if (uri == null) return null;
    String s = uri.toString();
    if (s.startsWith("classpath:")) return s.substring("classpath:".length());
    if (s.startsWith("file:")) {
      try {
        Path p = Paths.get(uri);
        Path cwd = Paths.get("").toAbsolutePath();
        if (p.startsWith(cwd)) return cwd.relativize(p).toString().replace('\\', '/');
        return p.toString().replace('\\', '/');
      } catch (Exception ignored) {
        return s;
      }
    }
    return s;
  }

  private static String mapCaseStatus(Status s) {
    if (s == null) return "broken";
    switch (s) {
      case PASSED:
        return "pass";
      case FAILED:
        return "fail";
      case SKIPPED:
      case PENDING:
        return "skip";
      case UNDEFINED:
      case AMBIGUOUS:
      case UNUSED:
      default:
        return "broken";
    }
  }

  private static String mapStepStatus(Status s) {
    String v = mapCaseStatus(s);
    return "broken".equals(v) ? "fail" : v;
  }

  private static int millisOfDuration(Result r) {
    if (r == null || r.getDuration() == null) return 0;
    return (int) Math.max(0L, r.getDuration().toMillis());
  }

  private static final Map<String, String> EXT_FOR_MIME = new HashMap<>();
  private static final Map<String, String> KIND_FOR_MIME = new HashMap<>();

  static {
    EXT_FOR_MIME.put("image/png", ".png");
    EXT_FOR_MIME.put("image/jpeg", ".jpg");
    EXT_FOR_MIME.put("image/webp", ".webp");
    EXT_FOR_MIME.put("video/mp4", ".mp4");
    EXT_FOR_MIME.put("video/webm", ".webm");
    EXT_FOR_MIME.put("text/html", ".html");
    EXT_FOR_MIME.put("application/json", ".json");
    EXT_FOR_MIME.put("text/plain", ".txt");

    KIND_FOR_MIME.put("image/png", "screenshot");
    KIND_FOR_MIME.put("image/jpeg", "screenshot");
    KIND_FOR_MIME.put("image/webp", "screenshot");
    KIND_FOR_MIME.put("video/mp4", "video");
    KIND_FOR_MIME.put("video/webm", "video");
    KIND_FOR_MIME.put("text/html", "html");
    KIND_FOR_MIME.put("application/json", "json");
    KIND_FOR_MIME.put("text/plain", "text");
  }

  private static String extensionForMime(String mime) {
    if (mime == null) return ".bin";
    String key = mime.toLowerCase(Locale.ROOT);
    int semi = key.indexOf(';');
    if (semi > 0) key = key.substring(0, semi).trim();
    return EXT_FOR_MIME.getOrDefault(key, ".bin");
  }

  private static String kindForMime(String mime) {
    if (mime == null) return "text";
    String key = mime.toLowerCase(Locale.ROOT);
    int semi = key.indexOf(';');
    if (semi > 0) key = key.substring(0, semi).trim();
    return KIND_FOR_MIME.getOrDefault(key, "text");
  }

  private static String safeName(String s) {
    return s.replaceAll("[^A-Za-z0-9._-]", "_");
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

  private static String detectCucumberVersion() {
    Package pkg = TestStep.class.getPackage();
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

  private static String shortId(int n) {
    return UUID.randomUUID().toString().replace("-", "").substring(0, n);
  }

  private static final class ScenarioCtx {
    String caseId;
    String fullName;
    String featureName;
    String scenarioName;
    String filePath;
    Integer line;
    long startedNanos;
    String startedAt;
    List<String> tags;
    String severity;
    final List<Map<String, Object>> steps = new ArrayList<>();
    final List<String> gherkin = new ArrayList<>();
    final List<Map<String, Object>> attachments = new ArrayList<>();
    final List<Map<String, Object>> logs = new ArrayList<>();
    Throwable firstError;
    CaseScratch scratch;
  }
}
