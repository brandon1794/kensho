# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'securerandom'
require_relative '../_schema'

# Cucumber 7+ formatter that emits Kensho v1 results.
#
# Cucumber-Ruby's formatter API gives us a `Cucumber::Configuration` and a
# `config.on_event(:event_name)` event bus. We subscribe to:
#
#   :test_run_started        — open the output dir
#   :test_case_started       — start accumulating per-scenario data
#   :test_step_finished      — append a step result
#   :test_case_finished      — write cases/<id>.json
#   :test_run_finished       — write run.json
#
# Each scenario becomes a Kensho case; each Gherkin step becomes a Kensho
# step. Data tables on a step are emitted as `step.parameters[]`. The
# scenario's `attach` calls (Cucumber's built-in attachment API) are
# routed into `case.attachments[]`.
#
# Tags drive metadata:
#
#   @severity:critical          → case.severity
#   @critical / @blocker / ...  → case.severity (shorthand)
#   @kensho.label.team=growth   → case.labels.team = 'growth'
#   @kensho.link.jira=PROJ-123  → case.links += { kind: 'jira', label: 'PROJ-123', url: 'PROJ-123' }
#   @kensho.url.jira=https://…  → case.links (full url form)
#   any other @tag              → case.tags

module Kensho
  module Cucumber
    class Formatter
      SEVERITY_TAGS = Kensho::Schema::SEVERITY.dup.freeze

      attr_reader :config

      def initialize(config)
        @config = config
        @ast_lookup = nil
        if defined?(::Cucumber::Formatter::AstLookup)
          begin
            @ast_lookup = ::Cucumber::Formatter::AstLookup.new(config)
          rescue StandardError
            @ast_lookup = nil
          end
        end
        @output_dir = File.expand_path(ENV['KENSHO_OUTPUT'] || (defined?(Kensho::Cucumber::DEFAULT_OUTPUT) ? Kensho::Cucumber::DEFAULT_OUTPUT : 'kensho-results'))
        @cases_dir = File.join(@output_dir, 'cases')
        @attachments_dir = File.join(@output_dir, 'attachments')
        @project = {
          'name' => ENV['KENSHO_PROJECT_NAME'] || 'Unknown project',
          'slug' => ENV['KENSHO_PROJECT_SLUG'] || Kensho::Schema.slugify(ENV['KENSHO_PROJECT_NAME'] || 'unknown')
        }
        @run_id = ENV['KENSHO_RUN_ID'] || Kensho::Schema.default_run_id
        @started_at = Kensho::Schema.iso_now
        @started_perf = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        @rootpath = Dir.pwd
        @cases_by_id = {}
        @ids_seen = Hash.new(0)

        # Per-test-case scratch keyed by test_case (Cucumber's TestCase obj).
        @scratch = {}

        FileUtils.mkdir_p(@cases_dir)
        FileUtils.mkdir_p(@attachments_dir)

        bind_events!
      end

      def bind_events!
        return unless @config.respond_to?(:on_event)

        @config.on_event(:test_case_started)  { |event| on_test_case_started(event) }
        @config.on_event(:test_step_finished) { |event| on_test_step_finished(event) }
        @config.on_event(:test_case_finished) { |event| on_test_case_finished(event) }
        @config.on_event(:test_run_finished)  { |_event| on_test_run_finished }
      end

      # ------- per-event handlers ------- #

      def on_test_case_started(event)
        test_case = event.test_case
        @current_test_case = test_case
        scenario_name = test_case.name.to_s
        feature_uri = test_case.location.file rescue nil
        feature_uri ||= (test_case.respond_to?(:source_location) ? test_case.source_location.file : nil)
        feature_name, rule_name = feature_and_rule(test_case)

        full_name = [feature_name, scenario_name].compact.reject(&:empty?).join(' › ')
        file_path = relpath(feature_uri, @rootpath)
        line = (test_case.location.lines.first rescue nil) || (test_case.location.line rescue nil)

        base_id = Kensho::Schema.stable_case_id(full_name, file_path)
        seen = @ids_seen[base_id]
        case_id = seen.zero? ? base_id : "#{base_id}_#{seen + 1}"
        @ids_seen[base_id] = seen + 1

        tags = (test_case.tags || []).map { |t| t.respond_to?(:name) ? t.name.to_s : t.to_s }
        clean_tags = tags.map { |t| t.start_with?('@') ? t[1..] : t }

        severity = severity_from_tags(clean_tags)
        labels = labels_from_tags(clean_tags)
        links = links_from_tags(clean_tags)

        plain_tags = clean_tags.reject do |t|
          t.start_with?('kensho.label.') || t.start_with?('kensho.link.') ||
            t.start_with?('kensho.url.') || t.start_with?('severity:') ||
            SEVERITY_TAGS.include?(t)
        end

        behavior = {}
        behavior['feature']  = feature_name.to_s if feature_name && !feature_name.empty?
        behavior['epic']     = rule_name.to_s    if rule_name && !rule_name.empty?
        behavior['scenario'] = scenario_name     if scenario_name && !scenario_name.empty?

        case_obj = {
          'id'        => case_id,
          'name'      => scenario_name,
          'fullName'  => full_name,
          'status'    => 'skip',
          'startedAt' => Kensho::Schema.iso_now,
          'duration'  => 0,
          'retries'   => 0,
          'platform'  => Kensho::Schema.normalize_os
        }
        case_obj['filePath'] = file_path if file_path
        case_obj['line']     = line.to_i if line
        case_obj['suite']    = [feature_name].compact.reject(&:empty?)
        case_obj.delete('suite') if case_obj['suite'].empty?
        case_obj['tags']     = plain_tags unless plain_tags.empty?
        case_obj['severity'] = severity if severity
        case_obj['labels']   = labels   unless labels.empty?
        case_obj['links']    = links    unless links.empty?
        case_obj['behavior'] = behavior unless behavior.empty?

        scratch = {
          case_obj: case_obj,
          started_perf: Process.clock_gettime(Process::CLOCK_MONOTONIC),
          started_iso: case_obj['startedAt'],
          steps: [],
          step_index: 0,
          worst_status: 'pass',
          first_error: nil,
          first_exception: nil,
          attachments: []
        }
        @scratch[test_case.object_id] = scratch
      end

      def on_test_step_finished(event)
        test_case = @current_test_case
        return unless test_case

        scratch = @scratch[test_case.object_id]
        return unless scratch

        step = event.test_step
        result = event.result

        title, parameters = step_title_and_params(step)
        # Cucumber emits hooks as test steps with no Gherkin source; skip
        # those from the timeline so the report shows just the user steps.
        return if title.nil?

        status = map_step_status(result)
        case_status = map_case_status(result)
        if case_status == 'fail' || case_status == 'broken'
          scratch[:worst_status] = case_status
        elsif case_status == 'skip' && scratch[:worst_status] == 'pass'
          scratch[:worst_status] = 'skip'
        end

        if (result.respond_to?(:failed?) && result.failed?) ||
           (result.respond_to?(:exception) && result.exception)
          scratch[:first_exception] ||= result.exception if result.respond_to?(:exception)
          scratch[:first_error] ||= (result.respond_to?(:exception) && result.exception) ?
                                    result.exception.message.to_s :
                                    result.to_s
        end

        duration_ms = duration_ms_from_result(result)
        idx = scratch[:step_index]
        scratch[:step_index] += 1

        step_obj = {
          'id'        => "step_#{idx}_#{SecureRandom.hex(3)}",
          'title'     => title,
          'status'    => status,
          'startedAt' => Kensho::Schema.iso_now,
          'duration'  => duration_ms
        }
        step_obj['parameters'] = parameters unless parameters.empty?
        scratch[:steps] << step_obj
      end

      def on_test_case_finished(event)
        test_case = event.test_case
        scratch = @scratch.delete(test_case.object_id)
        return unless scratch

        case_obj = scratch[:case_obj]
        result = event.result

        status =
          if result.respond_to?(:passed?) && result.passed?
            scratch[:worst_status] == 'pass' ? 'pass' : scratch[:worst_status]
          elsif result.respond_to?(:failed?) && result.failed?
            'fail'
          elsif result.respond_to?(:undefined?) && result.undefined?
            'broken'
          elsif result.respond_to?(:skipped?) && result.skipped?
            'skip'
          elsif result.respond_to?(:pending?) && result.pending?
            'skip'
          else
            scratch[:worst_status]
          end

        duration_ms = [(((Process.clock_gettime(Process::CLOCK_MONOTONIC) - scratch[:started_perf]) * 1000.0).round), 0].max

        case_obj['status']     = status
        case_obj['finishedAt'] = Kensho::Schema.iso_now
        case_obj['duration']   = duration_ms
        case_obj['steps']      = scratch[:steps] unless scratch[:steps].empty?

        if scratch[:first_exception] || scratch[:first_error]
          ex = scratch[:first_exception]
          message = ex ? ex.message.to_s.lines.first.to_s.strip : scratch[:first_error].to_s.lines.first.to_s.strip
          err = { 'message' => message.empty? ? 'failure' : message }
          if ex
            err['type']  = ex.class.name.to_s
            stack = [ex.message.to_s]
            stack.concat(Array(ex.backtrace).first(20))
            err['stack'] = stack.join("\n")
          elsif scratch[:first_error] && scratch[:first_error].to_s != message
            err['stack'] = scratch[:first_error].to_s
          end
          case_obj['errors'] = [err]
        end

        case_obj['attachments'] = scratch[:attachments] unless scratch[:attachments].empty?

        @cases_by_id[case_obj['id']] = case_obj
        write_case(case_obj)
      end

      def on_test_run_finished
        write_run_json
      rescue StandardError => e
        warn "[kensho] failed to write run.json: #{e.message}"
      end

      # ------- helpers ------- #

      def step_title_and_params(step)
        return [nil, []] if step.respond_to?(:hook?) && step.hook?

        text =
          if step.respond_to?(:text)
            step.text.to_s
          elsif step.respond_to?(:name)
            step.name.to_s
          else
            ''
          end
        return [nil, []] if text.empty?

        keyword = ''
        gherkin_step = nil
        if @ast_lookup
          begin
            src = @ast_lookup.step_source(step)
            gherkin_step = src && src.respond_to?(:step) ? src.step : nil
          rescue StandardError
            gherkin_step = nil
          end
          keyword = gherkin_step.keyword.to_s if gherkin_step && gherkin_step.respond_to?(:keyword)
        end
        title = keyword && !keyword.empty? ? "#{keyword}#{text}" : text

        params = []
        if gherkin_step && gherkin_step.respond_to?(:data_table) && gherkin_step.data_table
          rows = gherkin_step.data_table.rows
          rows.each_with_index do |row, ri|
            cells = row.respond_to?(:cells) ? row.cells : []
            cells.each_with_index do |cell, ci|
              value = cell.respond_to?(:value) ? cell.value.to_s : cell.to_s
              params << {
                'name' => "row#{ri}.col#{ci}",
                'value' => value,
                'kind' => 'data-row'
              }
            end
          end
        end
        if gherkin_step && gherkin_step.respond_to?(:doc_string) && gherkin_step.doc_string
          ds = gherkin_step.doc_string
          params << {
            'name' => 'docstring',
            'value' => ds.respond_to?(:content) ? ds.content.to_s : ds.to_s,
            'kind' => 'argument'
          }
        end

        [title, params]
      end

      def feature_and_rule(test_case)
        feature = nil
        rule = nil
        if @ast_lookup
          uri = test_case.location.file rescue nil
          if uri
            doc = nil
            begin
              doc = @ast_lookup.gherkin_document(uri)
            rescue StandardError
              doc = nil
            end
            if doc && doc.respond_to?(:feature) && doc.feature
              feature = doc.feature.name.to_s if doc.feature.respond_to?(:name)
              rule = walk_for_rule(doc.feature, test_case.location.lines.max) if doc.feature.respond_to?(:children)
            end
          end
        end
        [feature, rule]
      end

      def walk_for_rule(feature, line)
        feature.children.each do |child|
          next unless child.respond_to?(:rule) && child.rule

          rule = child.rule
          # Lines covered by this rule include all its scenarios.
          covered = false
          if rule.respond_to?(:children)
            rule.children.each do |sc_child|
              next unless sc_child.respond_to?(:scenario) && sc_child.scenario

              if sc_child.scenario.location.line == line ||
                 sc_child.scenario.steps.any? { |s| s.location.line == line }
                covered = true
                break
              end
            end
          end
          return rule.name.to_s if covered && rule.respond_to?(:name)
        end
        nil
      end

      def severity_from_tags(tags)
        tags.each do |t|
          return t.split(':', 2)[1].to_s.downcase if t.start_with?('severity:') &&
                                                     SEVERITY_TAGS.include?(t.split(':', 2)[1].to_s.downcase)
          return t.downcase if SEVERITY_TAGS.include?(t.downcase)
        end
        nil
      end

      def labels_from_tags(tags)
        labels = {}
        tags.each do |t|
          next unless t.start_with?('kensho.label.')

          rest = t.sub('kensho.label.', '')
          key, value = rest.split('=', 2)
          next if key.nil? || key.empty?

          labels[key] = (value || 'true').to_s
        end
        labels
      end

      def links_from_tags(tags)
        links = []
        tags.each do |t|
          if t.start_with?('kensho.url.')
            rest = t.sub('kensho.url.', '')
            kind, url = rest.split('=', 2)
            next if url.nil? || url.empty?

            link = { 'url' => url }
            link['kind'] = kind if kind && !kind.empty?
            links << link
          elsif t.start_with?('kensho.link.')
            rest = t.sub('kensho.link.', '')
            kind, label = rest.split('=', 2)
            next if label.nil? || label.empty?

            link = { 'url' => label, 'label' => label }
            link['kind'] = kind if kind && !kind.empty?
            links << link
          end
        end
        links
      end

      def map_case_status(result)
        return 'pass' if result.respond_to?(:passed?) && result.passed?
        return 'fail' if result.respond_to?(:failed?) && result.failed?
        return 'broken' if result.respond_to?(:undefined?) && result.undefined?
        return 'broken' if result.class.name.to_s.end_with?('::Undefined', '::Ambiguous')
        return 'skip'   if result.respond_to?(:skipped?) && result.skipped?
        return 'skip'   if result.respond_to?(:pending?) && result.pending?

        'pass'
      end

      def map_step_status(result)
        s = map_case_status(result)
        s == 'broken' ? 'fail' : s
      end

      def duration_ms_from_result(result)
        return 0 unless result.respond_to?(:duration) && result.duration

        d = result.duration
        if d.respond_to?(:nanoseconds)
          (d.nanoseconds / 1_000_000.0).round
        elsif d.respond_to?(:to_f)
          (d.to_f * 1000.0).round
        else
          0
        end
      end

      def write_case(case_obj)
        path = File.join(@cases_dir, "#{case_obj['id']}.json")
        File.write(path, JSON.pretty_generate(case_obj))
      rescue StandardError => e
        warn "[kensho] could not write #{File.basename(path)}: #{e.message}"
      end

      def write_run_json
        finished_at = Kensho::Schema.iso_now
        cases = @cases_by_id.values
        totals = { 'pass' => 0, 'fail' => 0, 'broken' => 0, 'skip' => 0 }
        cases.each { |c| totals[c['status']] += 1 if totals.key?(c['status']) }
        duration_ms = [((Process.clock_gettime(Process::CLOCK_MONOTONIC) - @started_perf) * 1000.0).round, 0].max
        framework_version = cucumber_version

        run = {
          'schemaVersion' => Kensho::Schema::SCHEMA_VERSION,
          'id'            => @run_id,
          'project'       => @project,
          'framework'     => { 'name' => 'cucumber-ruby', 'version' => framework_version },
          'env'           => Kensho::Schema.env_info(framework_version: framework_version),
          'startedAt'     => @started_at,
          'finishedAt'    => finished_at,
          'totals'        => totals,
          'durationMs'    => duration_ms,
          'testCases'     => cases
        }
        File.write(File.join(@output_dir, 'run.json'), JSON.pretty_generate(run))
      end

      def cucumber_version
        if defined?(::Cucumber::VERSION)
          ::Cucumber::VERSION.to_s
        else
          'unknown'
        end
      end

      def relpath(path, root)
        return nil unless path

        absolute_path = File.absolute_path(path.to_s)
        absolute_root = File.absolute_path(root.to_s)
        if absolute_path.start_with?(absolute_root + File::SEPARATOR)
          absolute_path[(absolute_root.length + 1)..]
        else
          path.to_s.sub(%r{\A\./}, '')
        end
      end
    end
  end
end
