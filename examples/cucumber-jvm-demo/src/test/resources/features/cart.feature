Feature: Cart

  @smoke @critical
  Scenario: User adds an item to the cart
    Given an empty cart
    When the user adds "Sneakers" to the cart
    Then the cart contains 1 item

  @blocker
  Scenario: User cannot check out an empty cart
    Given an empty cart
    When the user clicks checkout
    Then the system reports "Cart is empty"

  @regression
  Scenario Outline: Region-based pricing
    Given a price of 100 in region <region>
    When the discount is applied
    Then the final price is <expected>

    Examples:
      | region | expected |
      | EU     | 80       |
      | US     | 90       |
