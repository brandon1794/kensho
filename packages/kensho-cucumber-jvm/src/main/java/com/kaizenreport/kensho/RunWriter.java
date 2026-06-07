package com.kaizenreport.kensho;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Owns the {@code kensho-results/} folder and is shared by every adapter. Adapters call:
 *
 * <ul>
 *   <li>{@link #addCase(Map)} after each test finishes — it writes {@code cases/<id>.json}.
 *   <li>{@link #writeManifest(String)} at the end of the run — it writes {@code run.json}.
 * </ul>
 *
 * <p>Also implements {@link KenshoContext.AttachmentWriter} so the helper API can copy attachments
 * into the right place.
 */
public final class RunWriter implements KenshoContext.AttachmentWriter {

  public final Path outputDir;
  public final Path casesDir;
  public final Path attachmentsDir;
  public final Map<String, String> project; // name, slug, url
  public final String frameworkName;
  public final String frameworkVersion;
  public final String runId;
  public final String startedAt;

  private final List<Map<String, Object>> testCases = new ArrayList<>();
  private final ConcurrentMap<String, AtomicInteger> idCollisions = new ConcurrentHashMap<>();

  public RunWriter(
      Path outputDir,
      Map<String, String> project,
      String frameworkName,
      String frameworkVersion,
      String runId) {
    this.outputDir = outputDir;
    this.casesDir = outputDir.resolve("cases");
    this.attachmentsDir = outputDir.resolve("attachments");
    this.project = project;
    this.frameworkName = frameworkName;
    this.frameworkVersion = frameworkVersion;
    this.runId = runId == null ? defaultRunId() : runId;
    this.startedAt = isoNow();
    try {
      Files.createDirectories(casesDir);
      Files.createDirectories(attachmentsDir);
    } catch (IOException e) {
      System.err.println("[kensho] could not create output dirs: " + e.getMessage());
    }
  }

  /** Disambiguate duplicate ids (parametrized tests with identical fullName + filePath). */
  public synchronized String dedupeId(String baseId) {
    AtomicInteger counter = idCollisions.computeIfAbsent(baseId, k -> new AtomicInteger(0));
    int seen = counter.getAndIncrement();
    if (seen == 0) return baseId;
    return baseId + "_" + (seen + 1);
  }

  public synchronized void addCase(Map<String, Object> caseObj) {
    testCases.add(caseObj);
    Object id = caseObj.get("id");
    Path file = casesDir.resolve(String.valueOf(id) + ".json");
    try {
      Files.writeString(file, Json.stringify(caseObj));
    } catch (IOException e) {
      System.err.println("[kensho] failed to write case " + id + ": " + e.getMessage());
    }
  }

  public synchronized void writeManifest(String finishedAtOverride) {
    Map<String, Object> totals = new LinkedHashMap<>();
    totals.put("pass", 0);
    totals.put("fail", 0);
    totals.put("broken", 0);
    totals.put("skip", 0);
    for (Map<String, Object> c : testCases) {
      Object s = c.get("status");
      if (s instanceof String) {
        Integer cur = (Integer) totals.get(s);
        if (cur != null) totals.put((String) s, cur + 1);
      }
    }

    String finishedAt = finishedAtOverride == null ? isoNow() : finishedAtOverride;
    long durationMs = Math.max(0, Instant.parse(finishedAt).toEpochMilli()
        - Instant.parse(startedAt).toEpochMilli());

    Map<String, Object> framework = new LinkedHashMap<>();
    framework.put("name", frameworkName);
    framework.put("version", frameworkVersion == null ? "unknown" : frameworkVersion);

    Map<String, Object> run = new LinkedHashMap<>();
    run.put("schemaVersion", KenshoSchema.SCHEMA_VERSION);
    run.put("id", runId);
    run.put("project", project);
    run.put("framework", framework);
    run.put("env", EnvInfo.capture());
    run.put("startedAt", startedAt);
    run.put("finishedAt", finishedAt);
    run.put("totals", totals);
    run.put("durationMs", (int) durationMs);
    run.put("testCases", testCases);

    Path runJson = outputDir.resolve("run.json");
    try {
      Files.writeString(runJson, Json.stringify(run));
      System.out.println(
          "[kensho] wrote " + testCases.size() + " cases + run.json to " + outputDir);
    } catch (IOException e) {
      System.err.println("[kensho] failed to write run.json: " + e.getMessage());
    }
  }

  @Override
  public Map<String, Object> register(
      CaseScratch scratch,
      Path source,
      String kindOverride,
      String nameOverride,
      String mimeOverride) {
    if (source == null || !Files.isRegularFile(source)) {
      System.err.println("[kensho] attachment not found: " + source);
      return null;
    }
    Path caseDir = attachmentsDir.resolve(scratch.caseId);
    try {
      Files.createDirectories(caseDir);
    } catch (IOException e) {
      System.err.println("[kensho] failed to mkdir " + caseDir + ": " + e.getMessage());
      return null;
    }
    String attId = "att_" + shortId(8);
    String destName = nameOverride == null ? source.getFileName().toString() : nameOverride;
    Path dest = caseDir.resolve(attId + "_" + destName);
    try {
      Files.copy(source, dest, StandardCopyOption.REPLACE_EXISTING);
    } catch (IOException e) {
      System.err.println("[kensho] failed to copy attachment: " + e.getMessage());
      return null;
    }
    KenshoSchema.KindAndMime guessed = KenshoSchema.kindAndMimeFor(source.toString());
    Map<String, Object> rec = new LinkedHashMap<>();
    rec.put("id", attId);
    rec.put("kind", kindOverride != null ? kindOverride : guessed.kind);
    rec.put(
        "relativePath",
        outputDir.relativize(dest).toString().replace('\\', '/'));
    rec.put("mimeType", mimeOverride != null ? mimeOverride : guessed.mimeType);
    try {
      rec.put("sizeBytes", (int) Files.size(dest));
    } catch (IOException ignored) {
      // size is optional
    }
    return rec;
  }

  // ----- helpers ----- //

  public static String isoNow() {
    return DateTimeFormatter.ISO_INSTANT.format(Instant.now().truncatedTo(ChronoUnit.MILLIS));
  }

  public static String defaultRunId() {
    String stamp =
        DateTimeFormatter.ofPattern("yyyyMMddHHmmss")
            .withZone(java.time.ZoneOffset.UTC)
            .format(Instant.now());
    return "run_" + stamp;
  }

  public static String slugify(String name) {
    if (name == null) return "unknown";
    String s = name.toLowerCase(Locale.ROOT).trim();
    s = s.replaceAll("[^a-z0-9_-]+", "-");
    s = s.replaceAll("(^-+|-+$)", "");
    return s.isEmpty() ? "unknown" : s;
  }

  public static Path resolveOutput(String override) {
    String configured = override;
    if (configured == null || configured.isEmpty()) {
      configured = System.getProperty("kensho.output");
    }
    if (configured == null || configured.isEmpty()) {
      configured = System.getenv("KENSHO_OUTPUT");
    }
    if (configured == null || configured.isEmpty()) {
      configured = "kensho-results";
    }
    return Paths.get(configured).toAbsolutePath();
  }

  private static String shortId(int n) {
    return UUID.randomUUID().toString().replace("-", "").substring(0, n);
  }
}
