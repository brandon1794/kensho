package com.kaizenreport.kensho;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Mutable per-test scratch state populated by the helper API ({@link Kensho#step}, attach, label,
 * link). Kept package-private to the {@code com.kaizenreport.kensho} module — adapters reach into
 * it from their listeners. Thread-confined: see {@link KenshoContext}.
 */
public final class CaseScratch {

  public final String caseId;
  public final long startedAtMs;

  /** Top-level steps in order — children live on each parent's {@code children}. */
  public final List<Map<String, Object>> steps = new ArrayList<>();

  /** Stack of currently-open steps, innermost on top. */
  public final Deque<Map<String, Object>> stepStack = new ArrayDeque<>();

  /** Attachments anchored on the case directly. */
  public final List<Map<String, Object>> attachments = new ArrayList<>();

  public final Map<String, String> labels = new LinkedHashMap<>();
  public final List<Map<String, String>> links = new ArrayList<>();
  public final List<Map<String, Object>> logs = new ArrayList<>();

  /** Behavior fields set via {@link Kensho#epic}/{@link Kensho#feature}/{@link Kensho#story}. */
  public final Map<String, Object> behavior = new LinkedHashMap<>();

  /** Tags added via {@link Kensho#tag}. */
  public final List<String> tags = new ArrayList<>();

  /** Parameters added via {@link Kensho#parameter}. */
  public final List<Map<String, String>> parameters = new ArrayList<>();

  /** Severity set via {@link Kensho#severity} (validated). */
  public String severity = null;

  /** Owner set via {@link Kensho#owner}. */
  public String owner = null;

  /** Description set via {@link Kensho#description}. */
  public String description = null;

  /** Explicitly marked flaky via {@link Kensho#flaky()}. Merged into the case as {@code flaky:true}. */
  public boolean flaky = false;

  /** Marked muted/known-issue via {@link Kensho#muted()} / {@link Kensho#knownIssue}. Merged as {@code muted:true}. */
  public boolean muted = false;

  public CaseScratch(String caseId, long startedAtMs) {
    this.caseId = caseId;
    this.startedAtMs = startedAtMs;
  }
}
