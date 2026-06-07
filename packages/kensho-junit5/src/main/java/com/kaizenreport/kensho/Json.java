package com.kaizenreport.kensho;

import java.util.List;
import java.util.Map;

/**
 * Minimal pretty-printing JSON writer with no external dependencies. Supports {@code Map<String,
 * ?>}, {@link Iterable}, {@link Number}, {@link Boolean}, {@link String}, and {@code null}.
 *
 * <p>We hand-roll this so the adapter jar stays tiny — we don't want to drag Jackson/Gson into
 * every customer's classpath.
 */
public final class Json {

  private Json() {}

  public static String stringify(Object value) {
    StringBuilder sb = new StringBuilder(256);
    write(sb, value, 0);
    return sb.toString();
  }

  private static void write(StringBuilder sb, Object value, int indent) {
    if (value == null) {
      sb.append("null");
      return;
    }
    if (value instanceof Boolean || value instanceof Integer || value instanceof Long) {
      sb.append(value.toString());
      return;
    }
    if (value instanceof Number) {
      Number n = (Number) value;
      double d = n.doubleValue();
      if (Double.isNaN(d) || Double.isInfinite(d)) {
        sb.append("null");
      } else if (d == Math.floor(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) {
        sb.append(Long.toString((long) d));
      } else {
        sb.append(n.toString());
      }
      return;
    }
    if (value instanceof CharSequence) {
      writeString(sb, value.toString());
      return;
    }
    if (value instanceof Map) {
      writeObject(sb, (Map<?, ?>) value, indent);
      return;
    }
    if (value instanceof Iterable) {
      writeArray(sb, (Iterable<?>) value, indent);
      return;
    }
    if (value.getClass().isArray()) {
      throw new IllegalArgumentException(
          "Json: arrays not supported, use a List<>: " + value.getClass());
    }
    // Last-resort fall-back: stringify it (e.g. enums, paths).
    writeString(sb, value.toString());
  }

  private static void writeObject(StringBuilder sb, Map<?, ?> m, int indent) {
    if (m.isEmpty()) {
      sb.append("{}");
      return;
    }
    sb.append("{\n");
    int n = m.size();
    int i = 0;
    int childIndent = indent + 1;
    for (Map.Entry<?, ?> e : m.entrySet()) {
      writeIndent(sb, childIndent);
      writeString(sb, String.valueOf(e.getKey()));
      sb.append(": ");
      write(sb, e.getValue(), childIndent);
      if (++i < n) sb.append(',');
      sb.append('\n');
    }
    writeIndent(sb, indent);
    sb.append('}');
  }

  private static void writeArray(StringBuilder sb, Iterable<?> it, int indent) {
    // Materialize to size — we want trailing-comma handling without buffering.
    List<?> list;
    if (it instanceof List) {
      list = (List<?>) it;
    } else {
      java.util.ArrayList<Object> tmp = new java.util.ArrayList<>();
      for (Object o : it) tmp.add(o);
      list = tmp;
    }
    if (list.isEmpty()) {
      sb.append("[]");
      return;
    }
    sb.append("[\n");
    int n = list.size();
    int childIndent = indent + 1;
    for (int i = 0; i < n; i++) {
      writeIndent(sb, childIndent);
      write(sb, list.get(i), childIndent);
      if (i + 1 < n) sb.append(',');
      sb.append('\n');
    }
    writeIndent(sb, indent);
    sb.append(']');
  }

  private static void writeIndent(StringBuilder sb, int indent) {
    for (int i = 0; i < indent; i++) sb.append("  ");
  }

  private static void writeString(StringBuilder sb, String s) {
    sb.append('"');
    int len = s.length();
    for (int i = 0; i < len; i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\b':
          sb.append("\\b");
          break;
        case '\f':
          sb.append("\\f");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        default:
          if (c < 0x20 || (c >= 0x7F && c <= 0x9F)) {
            sb.append(String.format("\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
      }
    }
    sb.append('"');
  }
}
