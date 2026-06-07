package com.kaizenreport.kensho.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Sets {@code case.severity}. Accepted values: {@code blocker}, {@code critical}, {@code normal},
 * {@code minor}, {@code trivial}. Class-level annotations apply to every test in the class; method
 * annotations override.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface Severity {
  String value();
}
