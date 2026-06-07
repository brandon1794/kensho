package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.kaizenreport.kensho.annotations.Feature;
import com.kaizenreport.kensho.annotations.Minor;
import com.kaizenreport.kensho.annotations.Owner;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

@Feature("Calculator")
@Owner("bob")
class MathTest {

  @ParameterizedTest(name = "[a={0},b={1}]")
  @CsvSource({"1,2", "2,3", "10,20"})
  @Minor
  @Tag("regression")
  void adds(int a, int b) {
    assertEquals(a + b, a + b);
  }
}
