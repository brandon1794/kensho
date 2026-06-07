@feature:cart
Feature: Shopping cart
  As a shopper
  I want my totals to be correct
  So that I can check out with confidence

  Rule: Cart totals reflect line items

    @critical @smoke @kensho.label.team=growth @kensho.link.jira=PROJ-123
    Scenario: Cart with two items totals correctly
      Given I have an empty cart
      When I add the following items:
        | name    | price |
        | Widget  | 10    |
        | Gadget  | 20    |
      Then the cart total should be 30

    @blocker @kensho.url.runbook=https://runbooks.example.com/cart-promo
    Scenario: Promo code is applied incorrectly
      Given I have an empty cart
      When I add the following items:
        | name    | price |
        | Widget  | 10    |
        | Gadget  | 20    |
      And  I apply promo code "TENOFF"
      # The fake step definition intentionally produces 30 instead of 27,
      # so this scenario maps to status: 'fail' for the demo.
      Then the cart total should be 27

    @minor
    Scenario: Empty cart shows the empty-state message
      Given I have an empty cart
      Then I should see the empty-state CTA
