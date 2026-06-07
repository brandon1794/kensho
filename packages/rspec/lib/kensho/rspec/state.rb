# frozen_string_literal: true

# Per-example mutable state used by the public helper API.
#
# The formatter sets the current scratch on each example_started and clears
# it on example_passed/failed/pending. While an example is running, the
# Kensho.step / Kensho.attach / Kensho.label / Kensho.link helpers mutate
# the scratch directly so the formatter can pick up the data when it
# finalizes the case.
#
# RSpec runs examples sequentially within a worker by default; we still use
# Thread.current so threaded fixtures (rare) don't race.

module Kensho
  module RSpec
    class CaseScratch
      attr_accessor :case_id, :example_id, :started_at_ms,
                    :steps, :step_stack, :attachments, :logs, :labels, :links

      def initialize(case_id:, example_id:, started_at_ms:)
        @case_id = case_id
        @example_id = example_id
        @started_at_ms = started_at_ms
        @steps = []
        @step_stack = []
        @attachments = []
        @logs = []
        @labels = {}
        @links = []
      end
    end

    module State
      THREAD_KEY = :__kensho_rspec_scratch__
      GROUP_STACK_KEY = :__kensho_rspec_group_stack__

      def self.current
        Thread.current[THREAD_KEY]
      end

      def self.current=(scratch)
        Thread.current[THREAD_KEY] = scratch
      end

      def self.push_group(group)
        (Thread.current[GROUP_STACK_KEY] ||= []) << group
      end

      def self.pop_group
        stack = Thread.current[GROUP_STACK_KEY]
        stack&.pop
      end

      def self.current_group
        stack = Thread.current[GROUP_STACK_KEY]
        stack ? stack.last : nil
      end

      class << self
        attr_accessor :formatter
      end
    end
  end
end
