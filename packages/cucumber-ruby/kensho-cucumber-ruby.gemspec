# frozen_string_literal: true

lib = File.expand_path('lib', __dir__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'kensho/cucumber/version'

Gem::Specification.new do |spec|
  spec.name          = 'kensho-cucumber-ruby'
  spec.version       = Kensho::Cucumber::VERSION
  spec.authors       = ['KaizenReport']
  spec.summary       = 'Kensho reporter for Cucumber-Ruby — emits Kensho v1 results.'
  spec.description   = <<~DESC
    Cucumber 7+ formatter that writes a Kensho v1 result bundle
    (run.json + cases/<id>.json + attachments/) into ./kensho-results.
    Each scenario becomes a Kensho case; each Gherkin step becomes a
    Kensho step.
  DESC
  spec.homepage      = 'https://github.com/kaizenreport/kensho'
  spec.license       = 'Apache-2.0'
  spec.required_ruby_version = '>= 2.6'

  spec.metadata = {
    'homepage_uri'      => spec.homepage,
    'source_code_uri'   => spec.homepage,
    'bug_tracker_uri'   => spec.homepage + '/issues',
    'rubygems_mfa_required' => 'true'
  }

  spec.files = Dir['lib/**/*.rb'] + ['README.md']
  spec.require_paths = ['lib']

  spec.add_dependency 'cucumber', '>= 7.0'
end
