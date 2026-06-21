# frozen_string_literal: true

# Per-scenario state pointer used by the public Kensho.* helper API.
#
# The formatter stores its per-scenario scratch (a plain Hash) and points
# State.current at it on :test_case_started, clearing it on
# :test_case_finished. While a scenario runs the Kensho.label / Kensho.link /
# Kensho.flaky / etc. helpers mutate that Hash directly so the formatter can
# fold the data into the case when it finalizes.
#
# Cucumber-Ruby runs scenarios sequentially; we still key off Thread.current
# so step definitions running on a fixture thread (rare) don't race.

module Kensho
  module Cucumber
    module State
      THREAD_KEY = :__kensho_cucumber_scratch__

      def self.current
        Thread.current[THREAD_KEY]
      end

      def self.current=(scratch)
        Thread.current[THREAD_KEY] = scratch
      end
    end
  end
end
