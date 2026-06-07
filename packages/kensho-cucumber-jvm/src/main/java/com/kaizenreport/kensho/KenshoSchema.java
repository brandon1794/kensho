package com.kaizenreport.kensho;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Vendored slice of the Kensho v1 schema contract.
 *
 * <p>We deliberately avoid a runtime dep on the JS schema package — adapters stay tiny and
 * standalone. We re-implement the few bits the reporter cares about: the stable case-id hash, the
 * status / severity enums, and the attachment kind/MIME tables. Mirrors {@code packages/schema/}
 * and the pytest {@code _schema.py}.
 */
public final class KenshoSchema {

  private KenshoSchema() {}

  public static final String SCHEMA_VERSION = "kensho/v1";

  public static final List<String> STATUS = Arrays.asList("pass", "fail", "broken", "skip");
  public static final List<String> STEP_STATUS = Arrays.asList("pass", "fail", "skip");
  public static final List<String> SEVERITY =
      Arrays.asList("blocker", "critical", "normal", "minor", "trivial");
  public static final List<String> ATTACHMENT_KINDS =
      Arrays.asList(
          "screenshot", "video", "trace", "har", "text", "json", "html", "dom-snapshot", "log");

  private static final long FNV_OFFSET_1 = 0x811C9DC5L;
  private static final long FNV_OFFSET_2 = 0x01000193L;
  private static final long PRIME_1 = 0x01000193L;
  private static final long PRIME_2 = 0x85EBCA6BL;
  private static final long MASK = 0xFFFFFFFFL;

  /**
   * Compute the same stable id the JS adapters use. Mirrors {@code stableCaseId} from {@code
   * packages/schema/index.js} byte-for-byte: a double FNV-1a hash with two different secondary
   * primes so the two 32-bit chunks come from independent rolling states. We MUST keep this in
   * lock-step with the JS implementation or test history won't line up across adapters.
   *
   * <p>JS uses {@code charCodeAt} which returns a UTF-16 code unit (0..0xFFFF). Java's {@code
   * String.charAt} returns a {@code char} which is also a UTF-16 code unit, so iterating on chars
   * gives byte-for-byte parity with the JS implementation.
   */
  public static String stableCaseId(String fullName, String filePath) {
    String s = (fullName == null ? "" : fullName) + "::" + (filePath == null ? "" : filePath);
    long h1 = FNV_OFFSET_1;
    long h2 = FNV_OFFSET_2;
    for (int i = 0; i < s.length(); i++) {
      int c = s.charAt(i);
      h1 = ((h1 ^ c) * PRIME_1) & MASK;
      h2 = ((h2 ^ c) * PRIME_2) & MASK;
    }
    return "tc_" + pad8(h1) + pad8(h2);
  }

  private static String pad8(long v) {
    String hex = Long.toHexString(v & MASK);
    if (hex.length() >= 8) {
      return hex.substring(hex.length() - 8);
    }
    StringBuilder sb = new StringBuilder(8);
    for (int i = hex.length(); i < 8; i++) sb.append('0');
    sb.append(hex);
    return sb.toString();
  }

  /** Match (kind, mimeType) pair returned by {@link #kindAndMimeFor(String)}. */
  public static final class KindAndMime {
    public final String kind;
    public final String mimeType;

    public KindAndMime(String kind, String mimeType) {
      this.kind = kind;
      this.mimeType = mimeType;
    }
  }

  private static final Map<String, String> MIME_BY_EXT = new HashMap<>();
  private static final Map<String, String> KIND_BY_EXT = new HashMap<>();

  static {
    MIME_BY_EXT.put(".png", "image/png");
    MIME_BY_EXT.put(".jpg", "image/jpeg");
    MIME_BY_EXT.put(".jpeg", "image/jpeg");
    MIME_BY_EXT.put(".webp", "image/webp");
    MIME_BY_EXT.put(".webm", "video/webm");
    MIME_BY_EXT.put(".mp4", "video/mp4");
    MIME_BY_EXT.put(".zip", "application/zip");
    MIME_BY_EXT.put(".html", "text/html");
    MIME_BY_EXT.put(".json", "application/json");
    MIME_BY_EXT.put(".txt", "text/plain");
    MIME_BY_EXT.put(".log", "text/plain");
    MIME_BY_EXT.put(".har", "application/json");

    KIND_BY_EXT.put(".png", "screenshot");
    KIND_BY_EXT.put(".jpg", "screenshot");
    KIND_BY_EXT.put(".jpeg", "screenshot");
    KIND_BY_EXT.put(".webp", "screenshot");
    KIND_BY_EXT.put(".webm", "video");
    KIND_BY_EXT.put(".mp4", "video");
    KIND_BY_EXT.put(".zip", "trace");
    KIND_BY_EXT.put(".html", "html");
    KIND_BY_EXT.put(".json", "json");
    KIND_BY_EXT.put(".txt", "text");
    KIND_BY_EXT.put(".log", "log");
    KIND_BY_EXT.put(".har", "har");
  }

  public static KindAndMime kindAndMimeFor(String path) {
    String ext = "";
    if (path != null) {
      int dot = path.lastIndexOf('.');
      if (dot >= 0) ext = path.substring(dot).toLowerCase(Locale.ROOT);
    }
    String kind = KIND_BY_EXT.getOrDefault(ext, "text");
    String mime = MIME_BY_EXT.getOrDefault(ext, "application/octet-stream");
    return new KindAndMime(kind, mime);
  }

  public static boolean isValidSeverity(String value) {
    return value != null && SEVERITY.contains(value.toLowerCase(Locale.ROOT));
  }

  public static String normalizeSeverity(String value) {
    if (value == null) return null;
    String lower = value.toLowerCase(Locale.ROOT);
    return SEVERITY.contains(lower) ? lower : null;
  }
}
