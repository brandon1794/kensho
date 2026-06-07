package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;

import io.cucumber.java.Before;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import java.util.ArrayList;
import java.util.List;

public class CartSteps {

  private final List<String> cart = new ArrayList<>();
  private double price;
  private String region;
  private double finalPrice;
  private String lastError;
  private boolean checkedOut;

  @Before
  public void resetState() {
    cart.clear();
    price = 0;
    finalPrice = 0;
    region = null;
    lastError = null;
    checkedOut = false;
  }

  @Given("an empty cart")
  public void anEmptyCart() {
    cart.clear();
  }

  @When("the user adds {string} to the cart")
  public void userAdds(String item) {
    cart.add(item);
  }

  @Then("the cart contains {int} item")
  public void cartContains(int n) {
    assertEquals(n, cart.size());
  }

  @When("the user clicks checkout")
  public void userClicksCheckout() {
    if (cart.isEmpty()) {
      lastError = "Cart is empty";
      checkedOut = false;
    } else {
      checkedOut = true;
    }
  }

  @Then("the system reports {string}")
  public void systemReports(String msg) {
    if (!msg.equals(lastError)) {
      fail("Expected error '" + msg + "' but got '" + lastError + "'");
    }
  }

  @Given("a price of {int} in region {word}")
  public void priceInRegion(int p, String r) {
    this.price = p;
    this.region = r;
  }

  @When("the discount is applied")
  public void applyDiscount() {
    double rate = "EU".equals(region) ? 0.20 : 0.10;
    finalPrice = price * (1 - rate);
  }

  @Then("the final price is {int}")
  public void finalPriceIs(int expected) {
    assertEquals(expected, (int) finalPrice);
  }
}
