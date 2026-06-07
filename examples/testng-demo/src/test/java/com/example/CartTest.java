package com.example;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.fail;

import com.kaizenreport.kensho.Kensho;
import com.kaizenreport.kensho.annotations.Description;
import com.kaizenreport.kensho.annotations.Epic;
import com.kaizenreport.kensho.annotations.Feature;
import com.kaizenreport.kensho.annotations.Link;
import com.kaizenreport.kensho.annotations.Owner;
import com.kaizenreport.kensho.annotations.Story;
import org.testng.SkipException;
import org.testng.annotations.Test;

@Epic("Checkout")
@Feature("Cart")
@Owner("alice")
public class CartTest {

  @Test(groups = {"smoke", "critical"})
  @Story("User can put a product in the cart")
  @Link(url = "https://jira.example.com/browse/CART-1", kind = "jira", label = "CART-1")
  public void addItem() {
    try (var s = Kensho.step("open product page")) {
      // simulate
    }
    try (var s = Kensho.step("click add-to-cart")) {
      assertEquals(1, 1);
    }
    Kensho.label("team", "checkout");
  }

  @Test(groups = {"smoke", "blocker"})
  @Story("Checkout button shows a clear error when the cart is empty")
  public void checkoutFails() {
    try (var s = Kensho.step("submit empty cart")) {
      fail("Cart is empty — checkout should be disabled");
    }
  }

  @Test
  @Description("Skipped because the offline checkout flow only runs on staging.")
  public void skipUnsupported() {
    throw new SkipException("offline mode disabled in CI");
  }
}
