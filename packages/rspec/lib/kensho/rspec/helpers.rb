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

    def link(url, kind: nil, label: nil)
      scratch = Kensho::RSpec::State.current
      return if scratch.nil? || url.nil? || url.to_s.empty?

      entry = { 'url' => url.to_s }
      entry['kind']  = kind.to_s  if kind
      entry['label'] = label.to_s if label
      scratch.links << entry
      nil
    end

    def current_case_id
      scratch = Kensho::RSpec::State.current
      scratch ? scratch.case_id : nil
    end

    private

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

  # Lowercase aliases for callers who'd rather not use uppercase methods.
  class << self
    alias_method :feature, :Feature
    alias_method :epic,    :Epic
    alias_method :story,   :Story
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
