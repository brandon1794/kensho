# frozen_string_literal: true

lib = File.expand_path('lib', __dir__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'kensho/rspec/version'

Gem::Specification.new do |spec|
  spec.name          = 'kensho-rspec'
  spec.version       = Kensho::RSpec::VERSION
  spec.authors       = ['KaizenReport']
  spec.summary       = 'Kensho reporter for RSpec — emits Kensho v1 results that the Kensho CLI can render into a static HTML report.'
  spec.description   = <<~DESC
    RSpec 3+ formatter that writes a Kensho v1 result bundle (run.json +
    cases/<id>.json + attachments/) into ./kensho-results. Plus a tiny
    helper API (Kensho.step / Kensho.attach / Kensho.label / Kensho.link)
    for surfacing structured metadata from inside examples.
  DESC
  spec.homepage      = 'https://github.com/brandon1794/kensho'
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

  spec.add_dependency 'rspec-core', '>= 3.0'
end
