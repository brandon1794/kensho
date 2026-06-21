# frozen_string_literal: true

# Public entrypoint for kensho-cucumber-ruby.
#
# Usage:
#   bundle exec cucumber --format Kensho::Cucumber::Formatter

require_relative '_schema'
require_relative 'cucumber/version'
require_relative 'cucumber/state'
require_relative 'cucumber/helpers'
require_relative 'cucumber/formatter'

module Kensho
  module Cucumber
    DEFAULT_OUTPUT = 'kensho-results'
  end
end
