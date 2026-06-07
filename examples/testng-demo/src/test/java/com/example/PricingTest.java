package com.example;

import static org.testng.Assert.assertEquals;

import com.kaizenreport.kensho.annotations.Feature;
import com.kaizenreport.kensho.annotations.Minor;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

@Feature("Pricing")
public class PricingTest {

  @DataProvider(name = "regions")
  public Object[][] regions() {
    return new Object[][] {
      {"EU", 0.20, 100.0, 80.0},
      {"US", 0.10, 100.0, 90.0},
    };
  }

  @Test(dataProvider = "regions", groups = {"regression", "minor"})
  @Minor
  public void appliesDiscount(String region, double rate, double price, double expected) {
    double after = price * (1 - rate);
    assertEquals(after, expected, 0.001);
  }
}
