package com.kaizenreport.kensho;

/**
 * Thread-local hand-off between the test-framework listener (which knows when a test starts/ends)
 * and the {@link Kensho} helper API (which is called from inside test code). Listener calls {@link
 * #set(CaseScratch)} on test start and {@code set(null)} on finish. The helpers read {@link
 * #current()} and no-op when there is none, mirroring the pytest plugin's behaviour.
 *
 * <p>Also exposes a simple writer hook so the helper API can register attachments through whichever
 * adapter is active without the helpers needing to know the runner's filesystem layout.
 */
public final class KenshoContext {

  private KenshoContext() {}

  /** Writes attachments for an active case. Set by the listener at test-run time. */
  public interface AttachmentWriter {
    /**
     * Copy {@code source} into the run's {@code attachments/<caseId>/} folder and return an
     * attachment record (with {@code id}, {@code kind}, {@code relativePath}, {@code mimeType}) or
     * {@code null} on failure.
     */
    java.util.Map<String, Object> register(
        CaseScratch scratch,
        java.nio.file.Path source,
        String kindOverride,
        String nameOverride,
        String mimeOverride);
  }

  private static final ThreadLocal<CaseScratch> CURRENT = new ThreadLocal<>();
  private static volatile AttachmentWriter writer;

  public static CaseScratch current() {
    return CURRENT.get();
  }

  public static void set(CaseScratch scratch) {
    if (scratch == null) {
      CURRENT.remove();
    } else {
      CURRENT.set(scratch);
    }
  }

  public static AttachmentWriter writer() {
    return writer;
  }

  public static void setWriter(AttachmentWriter w) {
    writer = w;
  }
}
