# frozen_string_literal: true

require 'securerandom'
require 'fileutils'

# Public helper API used inside RSpec examples.
#
#   Kensho.step('open the login page') { ... }       # nests automatically
#   Kensho.attach('/tmp/login.png', kind: 'screenshot')
#   Kensho.label('team', 'growth')
#   Kensho.link('https://jira.example.com/browse/PROJ-123', kind: 'jira', label: 'PROJ-123')
#   Kensho.current_case_id  # stable id of the running test, or nil
#
# All helpers are no-ops outside an example so they're safe to call from
# shared utility code that may run outside a test context.
#
# Top-level Kensho::Feature/Epic/Story sugar lets the spec author tag an
# example group without typing :metadata twice. They mirror how the
# pytest plugin exposes @feature/@epic/@story marks.

module Kensho
  class << self
    def step(title, action: nil)
      scratch = Kensho::RSpec::State.current
      unless scratch
        return yield({}) if block_given?

        return {}
      end

      started_perf = monotonic_now
      step_obj = {
        'id'        => "step_#{SecureRandom.hex(5)}",
        'title'     => title.to_s,
        'status'    => 'pass',
        'startedAt' => Kensho::Schema.iso_now,
        'duration'  => 0,
        '_started_perf' => started_perf
      }
      step_obj['action'] = action.to_s if action

      parent = scratch.step_stack.last
      if parent
        (parent['children'] ||= []) << step_obj
      else
        scratch.steps << step_obj
      end
      scratch.step_stack << step_obj

      result = nil
      begin
        result = block_given? ? yield(step_obj) : nil
      rescue StandardError, ::RSpec::Expectations::ExpectationNotMetError => e
        step_obj['status'] = 'fail'
        close_step!(step_obj, started_perf)
        scratch.step_stack.pop if scratch.step_stack.last.equal?(step_obj)
        raise e
      end

      close_step!(step_obj, started_perf)
      scratch.step_stack.pop if scratch.step_stack.last.equal?(step_obj)
      result
    end

    def attach(path, kind: nil, name: nil, mime_type: nil)
      scratch = Kensho::RSpec::State.current
      formatter = Kensho::RSpec::State.formatter
      return nil unless scratch && formatter

      record = formatter.register_attachment(
        scratch,
        path.to_s,
        kind: kind,
        name: name,
        mime_type: mime_type
      )
      return nil unless record

      if scratch.step_stack.last
        (scratch.step_stack.last['attachments'] ||= []) << record
      else
        scratch.attachments << record
      end
      record
    end

    def label(key, value)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || key.nil? || key.to_s.empty?

      scratch.labels[key.to_s] = value.to_s
      nil
    end

    # Add a hyperlink to the running case. Positional `name` is the human
    # label (legacy `label:`/`kind:` keywords still work). Default kind is
    # 'link'.
    def link(url, name = nil, kind: nil, label: nil)
      add_link(url, kind: kind || 'link', label: name || label)
    end

    # A Jira/issue link. `id_or_url` may be a bare ticket id ('PROJ-1') or a
    # full URL. Kind 'issue'.
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

    # Set case.severity. Only the five canonical names are accepted; anything
    # else is ignored.
    def severity(value)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || value.nil?

      v = value.to_s
      scratch.severity = v if Kensho::Schema::SEVERITY.include?(v)
      nil
    end

    # Set case.owner.
    def owner(value)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || value.nil?

      scratch.owner = value.to_s
      nil
    end

    # Set case.description.
    def description(text)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || text.nil?

      scratch.description = text.to_s
      nil
    end

    # Add a tag to the running case. Strips a leading '@' and de-dupes.
    def tag(name)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || name.nil?

      t = name.to_s.sub(/\A@/, '')
      return if t.empty?

      scratch.tags << t unless scratch.tags.include?(t)
      nil
    end

    # Add a parameter (name/value) to the running case. No kind.
    def parameter(name, value)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || name.nil? || name.to_s.empty?

      scratch.parameters << { 'name' => name.to_s, 'value' => value.to_s }
      nil
    end

    # Mark the running case as flaky.
    def flaky
      scratch = Kensho::RSpec::State.current
      return if scratch.nil?

      scratch.flaky = true
      nil
    end

    # Mark the running case as muted (known failure not counted by the gate).
    def muted
      scratch = Kensho::RSpec::State.current
      return if scratch.nil?

      scratch.muted = true
      nil
    end

    # A known issue: mutes the case and records an 'issue' link.
    def known_issue(id_or_url, label = nil)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil?

      scratch.muted = true
      jira_link(id_or_url, label)
      nil
    end

    def current_case_id
      scratch = Kensho::RSpec::State.current
      scratch ? scratch.case_id : nil
    end

    private

    def add_link(url, kind:, label:)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || url.nil? || url.to_s.empty?

      entry = { 'url' => url.to_s }
      entry['kind']  = kind.to_s  if kind && !kind.to_s.empty?
      entry['label'] = label.to_s if label && !label.to_s.empty?
      scratch.links << entry
      nil
    end

    def apply_behavior_runtime(behavior_key, label_key, value)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || value.nil? || value.to_s.empty?

      scratch.behavior[behavior_key] = value.to_s
      scratch.labels[label_key] = value.to_s
      nil
    end

    def monotonic_now
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def close_step!(step_obj, started_perf)
      step_obj['duration'] = [(((monotonic_now - started_perf) * 1000.0).round), 0].max
      step_obj.delete('_started_perf')
    end
  end

  # Top-level sugar so spec authors can write `Kensho::Feature('Cart')` etc.
  # inside a describe block. These are module methods (uppercase method
  # names are legal in Ruby) that walk the binding to find the example
  # group whose `describe` block is currently executing and set metadata
  # on it.
  def self.Feature(name)
    apply_behavior(:kensho_feature, name)
  end

  def self.Epic(name)
    apply_behavior(:kensho_epic, name)
  end

  def self.Story(name)
    apply_behavior(:kensho_story, name)
  end

  def self.apply_behavior(key, value)
    group = Kensho::RSpec::State.current_group
    return unless group

    group.metadata[key] = value.to_s
    nil
  end
end

# Hook into RSpec's example-group definition so we can track the
# currently-defining group. RSpec calls `subclass` for every nested
# describe; we wrap it to push/pop a stack on the State module.
module Kensho
  module RSpec
    # Hook RSpec's example-group definition so Kensho::Feature/Epic/Story
    # can find the group whose describe block is currently executing.
    # We override `module_exec` on the freshly-built subclass to push the
    # class onto a tracking stack while RSpec evaluates the user body.
    module GroupTracker
      def subclass(parent, description, args, registration_collection, &example_group_block)
        wrapped = nil
        if example_group_block
          tracker = Kensho::RSpec::State
          wrapped = lambda do |*lambda_args|
            tracker.push_group(self)
            begin
              instance_exec(*lambda_args, &example_group_block)
            ensure
              tracker.pop_group
            end
          end
        end
        super(parent, description, args, registration_collection, &(wrapped || example_group_block))
      end
    end
  end
end

if defined?(::RSpec::Core::ExampleGroup)
  ::RSpec::Core::ExampleGroup.singleton_class.prepend(Kensho::RSpec::GroupTracker)
end
