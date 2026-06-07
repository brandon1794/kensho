# frozen_string_literal: true

require 'kensho/rspec'

# Project metadata for the demo. Real apps will set these via env vars
# (KENSHO_PROJECT_NAME / KENSHO_PROJECT_SLUG) or in CI.
ENV['KENSHO_PROJECT_NAME'] ||= 'Kensho RSpec Demo'
ENV['KENSHO_PROJECT_SLUG'] ||= 'kensho-rspec-demo'

RSpec.configure do |config|
  config.expect_with :rspec do |c|
    c.syntax = :expect
  end
end
