package com.kaizenreport.kensho;

import java.io.File;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Public Kensho helper API. Available to test code regardless of which adapter (junit5, testng,
 * cucumber-jvm) is registered as the listener — they all populate the same thread-local
 * {@link KenshoContext}.
 *
 * <p>All methods are no-ops when called outside a running test, so it's safe to sprinkle them in
 * shared utility code.
 *
 * <pre>{@code
 * import com.kaizenreport.kensho.Kensho;
 *
 * @Test
 * void login() {
 *   try (Kensho.Step s = Kensho.step("open the login page")) {
 *     // ...
 *   }
 *   Kensho.label("team", "growth");
 *   Kensho.link("https://jira.example.com/browse/PROJ-123", "jira", "PROJ-123");
 *   Kensho.attach(new File("/tmp/login.png"), "screenshot");
 * }
 * }</pre>
 */
public final class Kensho {

  private Kensho() {}

  /** Open a new step. Use as an {@link AutoCloseable} in a try-with-resources block. */
  public static Step step(String title) {
    return step(title, null);
  }

  public static Step step(String title, String action) {
    CaseScratch scratch = KenshoContext.current();
    if (scratch == null) return Step.NOOP;
    Map<String, Object> stepObj = new LinkedHashMap<>();
    stepObj.put("id", "step_" + shortId());
    stepObj.put("title", title == null ? "" : title);
    stepObj.put("status", "pass");
    stepObj.put("startedAt", Instant.now().toString());
    stepObj.put("duration", 0);
    if (action != null && !action.isEmpty()) stepObj.put("action", action);

    Map<String, Object> parent = scratch.stepStack.peek();
    if (parent != null) {
      @SuppressWarnings("unchecked")
      java.util.List<Map<String, Object>> children =
          (java.util.List<Map<String, Object>>) parent.get("children");
      if (children == null) {
        children = new java.util.ArrayList<>();
        parent.put("children", children);
      }
      children.add(stepObj);
    } else {
      scratch.steps.add(stepObj);
    }
    scratch.stepStack.push(stepObj);
    return new Step(scratch, stepObj, System.nanoTime());
  }

  /** Set {@code case.labels[key] = value}. No-op outside an active test. */
  public static void label(String key, String value) {
    CaseScratch scratch = KenshoContext.current();
    if (scratch == null || key == null || key.isEmpty()) return;
    scratch.labels.put(key, value == null ? "" : value);
  }

  /** Attach a hyperlink to the running case. */
  public static void link(String url) {
    link(url, null, null);
  }

  public static void link(String url, String kind, String label) {
    CaseScratch scratch = KenshoContext.current();
    if (scratch == null || url == null || url.isEmpty()) return;
    Map<String, String> entry = new LinkedHashMap<>();
    entry.put("url", url);
    if (kind != null && !kind.isEmpty()) entry.put("kind", kind);
    if (label != null && !label.isEmpty()) entry.put("label", label);
    scratch.links.add(entry);
  }

  /**
   * Copy a file into the run's {@code attachments/<caseId>/} folder and register it on the case
   * (or on the innermost open step). No-op outside a test or when the file is missing.
   */
  public static Map<String, Object> attach(File file, String kind) {
    return attach(file == null ? null : file.toPath(), kind, null, null);
  }

  public static Map<String, Object> attach(Path path, String kind) {
    return attach(path, kind, null, null);
  }

  public static Map<String, Object> attach(Path path, String kind, String name, String mimeType) {
    CaseScratch scratch = KenshoContext.current();
    if (scratch == null || path == null) return null;
    KenshoContext.AttachmentWriter w = KenshoContext.writer();
    if (w == null) return null;
    Map<String, Object> record = w.register(scratch, path, kind, name, mimeType);
    if (record == null) return null;
    Map<String, Object> innerStep = scratch.stepStack.peek();
    if (innerStep != null) {
      @SuppressWarnings("unchecked")
      java.util.List<Map<String, Object>> arr =
          (java.util.List<Map<String, Object>>) innerStep.get("attachments");
      if (arr == null) {
        arr = new java.util.ArrayList<>();
        innerStep.put("attachments", arr);
      }
      arr.add(record);
    } else {
      scratch.attachments.add(record);
    }
    return record;
  }

  /** Stable id of the test currently running, or {@code null}. */
  public static String currentCaseId() {
    CaseScratch scratch = KenshoContext.current();
    return scratch == null ? null : scratch.caseId;
  }

  private static String shortId() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 10);
  }

  /** Auto-closable handle returned by {@link Kensho#step}. */
  public static final class Step implements AutoCloseable {

    static final Step NOOP = new Step(null, null, 0L);

    private final CaseScratch scratch;
    private final Map<String, Object> obj;
    private final long startedNanos;
    private boolean closed;
    private String forcedStatus;

    Step(CaseScratch scratch, Map<String, Object> obj, long startedNanos) {
      this.scratch = scratch;
      this.obj = obj;
      this.startedNanos = startedNanos;
    }

    /** Mark the step as failed. Useful when an assertion fails but no exception is thrown. */
    public void fail() {
      forcedStatus = "fail";
    }

    /** Mark the step as skipped. */
    public void skip() {
      forcedStatus = "skip";
    }

    /** Add a parameter to the step ({@code parameters[]}). */
    public Step parameter(String name, String value) {
      if (obj == null || name == null) return this;
      @SuppressWarnings("unchecked")
      java.util.List<Map<String, String>> params =
          (java.util.List<Map<String, String>>) obj.get("parameters");
      if (params == null) {
        params = new java.util.ArrayList<>();
        obj.put("parameters", params);
      }
      Map<String, String> p = new LinkedHashMap<>();
      p.put("name", name);
      p.put("value", value == null ? "" : value);
      params.add(p);
      return this;
    }

    @Override
    public void close() {
      if (closed) return;
      closed = true;
      if (obj == null || scratch == null) return;
      long ms = Math.max(0L, (System.nanoTime() - startedNanos) / 1_000_000L);
      obj.put("duration", ms);
      if (forcedStatus != null) obj.put("status", forcedStatus);
      // Pop only if we're still on top — defensive against bad nesting.
      if (!scratch.stepStack.isEmpty() && scratch.stepStack.peek() == obj) {
        scratch.stepStack.pop();
      }
    }
  }
}
