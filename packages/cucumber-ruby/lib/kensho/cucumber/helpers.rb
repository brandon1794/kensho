# frozen_string_literal: true

require_relative '../_schema'
require_relative 'state'

# Public helper API usable from inside Cucumber step definitions.
#
#   Kensho.label('team', 'growth')
#   Kensho.link('https://example.com/docs', 'Docs')
#   Kensho.jira_link('PROJ-123')
#   Kensho.epic('Checkout'); Kensho.feature('Cart'); Kensho.story('Empty cart')
#   Kensho.severity('critical'); Kensho.owner('alice')
#   Kensho.flaky; Kensho.muted; Kensho.known_issue('PROJ-1')
#
# All helpers are no-ops outside a running scenario, so they're safe to call
# from shared support code. Runtime annotations win over tag-derived values.

module Kensho
  class << self
    def label(key, value)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || key.nil? || key.to_s.empty?

      (scratch[:rt_labels] ||= {})[key.to_s] = value.to_s
      nil
    end

    # Add a hyperlink. Positional `name` is the human label. Kind 'link'.
    def link(url, name = nil, kind: nil, label: nil)
      add_link(url, kind: kind || 'link', label: name || label)
    end

    # A Jira/issue link. `id_or_url` may be a bare ticket id or a full URL.
    def jira_link(id_or_url, label = nil)
      add_link(id_or_url, kind: 'issue', label: label || id_or_url)
    end

    # A reference/documentation link. Kind 'reference'.
    def reference_link(url, label = nil)
      add_link(url, kind: 'reference', label: label)
    end

    # behavior.epic + labels.epic
    def epic(name)
      apply_behavior_runtime('epic', 'epic', name)
    end

    # behavior.feature + labels.feature
    def feature(name)
      apply_behavior_runtime('feature', 'feature', name)
    end

    # behavior.scenario + labels.story
    def story(name)
      apply_behavior_runtime('scenario', 'story', name)
    end

    # Set case.severity. Only the five canonical names are accepted.
    def severity(value)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || value.nil?

      v = value.to_s
      scratch[:rt_severity] = v if Kensho::Schema::SEVERITY.include?(v)
      nil
    end

    # Set case.owner.
    def owner(value)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || value.nil?

      scratch[:rt_owner] = value.to_s
      nil
    end

    # Set case.description.
    def description(text)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || text.nil?

      scratch[:rt_description] = text.to_s
      nil
    end

    # Add a tag. Strips a leading '@' and de-dupes.
    def tag(name)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || name.nil?

      t = name.to_s.sub(/\A@/, '')
      return if t.empty?

      tags = (scratch[:rt_tags] ||= [])
      tags << t unless tags.include?(t)
      nil
    end

    # Add a parameter (name/value). No kind.
    def parameter(name, value)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || name.nil? || name.to_s.empty?

      (scratch[:rt_parameters] ||= []) << { 'name' => name.to_s, 'value' => value.to_s }
      nil
    end

    # Mark the running scenario flaky.
    def flaky
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil?

      scratch[:flaky] = true
      nil
    end

    # Mark the running scenario muted (known failure not counted by the gate).
    def muted
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil?

      scratch[:muted] = true
      nil
    end

    # A known issue: mutes the scenario and records an 'issue' link.
    def known_issue(id_or_url, label = nil)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil?

      scratch[:muted] = true
      jira_link(id_or_url, label)
      nil
    end

    def current_case_id
      scratch = Kensho::Cucumber::State.current
      scratch && scratch[:case_obj] ? scratch[:case_obj]['id'] : nil
    end

    private

    def add_link(url, kind:, label:)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || url.nil? || url.to_s.empty?

      entry = { 'url' => url.to_s }
      entry['kind']  = kind.to_s  if kind && !kind.to_s.empty?
      entry['label'] = label.to_s if label && !label.to_s.empty?
      (scratch[:rt_links] ||= []) << entry
      nil
    end

    def apply_behavior_runtime(behavior_key, label_key, value)
      scratch = Kensho::Cucumber::State.current
      return if scratch.nil? || value.nil? || value.to_s.empty?

      (scratch[:rt_behavior] ||= {})[behavior_key] = value.to_s
      (scratch[:rt_labels] ||= {})[label_key] = value.to_s
      nil
    end
  end
end
