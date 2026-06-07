# frozen_string_literal: true

Given('I have an empty cart') do
  @cart = []
end

When('I add the following items:') do |table|
  table.hashes.each do |row|
    @cart << { name: row['name'], price: row['price'].to_i }
  end
end

When('I apply promo code {string}') do |_code|
  # In a real app this would discount @cart; we leave it untouched so the
  # downstream Then assertion fails on purpose.
end

Then('the cart total should be {int}') do |expected|
  total = @cart.sum { |i| i[:price] }
  raise "cart total mismatch: expected #{expected}, got #{total}" unless total == expected
end

Then('I should see the empty-state CTA') do
  raise 'expected an empty cart' unless @cart.empty?
end
