# frozen_string_literal: true

# Public entrypoint for kensho-rspec.
#
# Usage:
#   require 'kensho/rspec'
#   rspec --format Kensho::RSpec::Formatter
#
# The helper API (Kensho.step, Kensho.attach, Kensho.label, Kensho.link,
# Kensho.current_case_id) is wired up here so test code only needs one
# `require`. All four helpers are no-ops outside a running example, so it
# is safe to call them from shared utility code.

require_relative '_schema'
require_relative 'rspec/version'
require_relative 'rspec/state'
require_relative 'rspec/helpers'
require_relative 'rspec/formatter'

module Kensho
  module RSpec
    DEFAULT_OUTPUT = 'kensho-results'
  end
end
