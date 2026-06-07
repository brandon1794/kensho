# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'fileutils'
require 'stringio'
require 'set'
require_relative '../_schema'
require_relative 'state'
require_relative 'helpers'

# RSpec formatter that emits a Kensho v1 result bundle.
#
# Layout written under KENSHO_OUTPUT (default ./kensho-results):
#
#   kensho-results/
#     run.json                 manifest (project, env, totals, framework, timing)
#     cases/<stableId>.json    one file per example
#     attachments/<caseId>/    files registered via Kensho.attach
#
# Register with RSpec:
#
#   rspec --format Kensho::RSpec::Formatter
#
# CLI flags / env vars (the formatter has no rspec-options DSL since
# RSpec doesn't pass those through formatter args reliably; we use env
# vars + the `.kensho.yml`-free philosophy of the JS adapters):
#
#   KENSHO_OUTPUT             output directory (default ./kensho-results)
#   KENSHO_PROJECT_NAME       project name in run.json
#   KENSHO_PROJECT_SLUG       project slug
#   KENSHO_RUN_ID             override the auto-generated run id
#   KENSHO_NO_SEVERITY_FROM_META  set to "1" to disable severity-from-metadata

require 'rspec/core/formatters/base_formatter' unless defined?(::RSpec::Core::Formatters::BaseFormatter)

module Kensho
  module RSpec
    class Formatter < ::RSpec::Core::Formatters::BaseFormatter
      ::RSpec::Core::Formatters.register self,
                                         :start,
                                         :example_group_started,
                                         :example_started,
                                         :example_passed,
                                         :example_failed,
                                         :example_pending,
                                         :stop

      SEVERITY_KEYS = Kensho::Schema::SEVERITY.map(&:to_sym).freeze

      # Metadata keys that aren't user tags. We prune these from the tag
      # list so RSpec's housekeeping (location, type, file_path, etc.)
      # doesn't pollute case.tags.
      META_BLOCKLIST = %i[
        absolute_file_path block default_path described_class description
        described_class_name described_class_name described_at description_args
        execution_result file_path file_path_proc full_description
        kensho_feature kensho_epic kensho_story
        last_run_status line_number location parent_example_group
        rerun_file_path scoped_id severity shared_group_inclusions
        shared_group_metadata shared_group_inclusion_backtrace
        skip stack_frames type variants
      ].to_set

      def initialize(output = nil)
        # RSpec's BaseFormatter wants an output IO; we never write to it,
        # but we still hand one up so RSpec doesn't blow up.
        super(output || StringIO.new)
        @output_dir = File.expand_path(ENV['KENSHO_OUTPUT'] || (defined?(Kensho::RSpec::DEFAULT_OUTPUT) ? Kensho::RSpec::DEFAULT_OUTPUT : 'kensho-results'))
        @cases_dir = File.join(@output_dir, 'cases')
        @attachments_dir = File.join(@output_dir, 'attachments')
        @project = {
          'name' => ENV['KENSHO_PROJECT_NAME'] || 'Unknown project',
          'slug' => ENV['KENSHO_PROJECT_SLUG'] || Kensho::Schema.slugify(ENV['KENSHO_PROJECT_NAME'] || 'unknown')
        }
        @run_id = ENV['KENSHO_RUN_ID'] || Kensho::Schema.default_run_id
        @severity_from_meta = ENV['KENSHO_NO_SEVERITY_FROM_META'].to_s.empty?
        @started_at = Kensho::Schema.iso_now
        @started_perf = monotonic_now
        @rootpath = Dir.pwd

        @cases_by_id = {}
        @ids_seen = Hash.new(0)
        @groups = {}

        FileUtils.mkdir_p(@cases_dir)
        FileUtils.mkdir_p(@attachments_dir)

        Kensho::RSpec::State.formatter = self
        install_capture_hook!
      end

      # Tee stdout/stderr around each example into the per-case scratch so
      # case.logs[] picks up `puts` calls without the user having to do
      # anything. RSpec doesn't expose a "captured output" API for
      # arbitrary formatters, so we install a global before/after hook.
      def install_capture_hook!
        return if @capture_installed

        @capture_installed = true
        ::RSpec.configure do |config|
          config.before(:each) do
            scratch = Kensho::RSpec::State.current
            next unless scratch

            stdout_io = StringIO.new
            stderr_io = StringIO.new
            scratch.instance_variable_set(:@orig_stdout, $stdout)
            scratch.instance_variable_set(:@orig_stderr, $stderr)
            scratch.instance_variable_set(:@stdout_io, stdout_io)
            scratch.instance_variable_set(:@stderr_io, stderr_io)
            $stdout = stdout_io
            $stderr = stderr_io
          end

          config.after(:each) do
            scratch = Kensho::RSpec::State.current
            next unless scratch

            stdout_io = scratch.instance_variable_get(:@stdout_io)
            stderr_io = scratch.instance_variable_get(:@stderr_io)
            orig_out = scratch.instance_variable_get(:@orig_stdout)
            orig_err = scratch.instance_variable_get(:@orig_stderr)
            $stdout = orig_out if orig_out
            $stderr = orig_err if orig_err
            scratch.instance_variable_set(:@stdout_text, stdout_io.string) if stdout_io
            scratch.instance_variable_set(:@stderr_text, stderr_io.string) if stderr_io
          end
        end
      end

      # ----- lifecycle hooks ----- #

      def start(_notification); end

      def example_group_started(notification)
        group = notification.group
        @groups[group.metadata[:scoped_id] || group.object_id] = collect_group_meta(group)
      end

      def example_started(notification)
        example = notification.example
        case_obj = build_case(example)
        scratch = CaseScratch.new(
          case_id: case_obj['id'],
          example_id: example.id,
          started_at_ms: (Time.now.to_f * 1000.0)
        )
        scratch.instance_variable_set(:@case_obj, case_obj)
        scratch.instance_variable_set(:@stdout_capture, StringIO.new)
        scratch.instance_variable_set(:@stderr_capture, StringIO.new)
        State.current = scratch

        @cases_by_id[case_obj['id']] = case_obj
      end

      def example_passed(notification)
        finalize(notification.example, 'pass', nil)
      end

      def example_failed(notification)
        ex = notification.example.execution_result.exception
        status =
          if ex && (ex.class.name == 'RSpec::Expectations::ExpectationNotMetError')
            'fail'
          elsif ex
            'broken'
          else
            'fail'
          end
        finalize(notification.example, status, ex)
      end

      def example_pending(notification)
        finalize(notification.example, 'skip', nil)
      end

      def stop(_notification)
        write_run_json
      ensure
        State.formatter = nil
      end

      # ----- internals ----- #

      def register_attachment(scratch, src_path, kind:, name:, mime_type:)
        return nil unless File.file?(src_path)

        attachments_root = File.join(@attachments_dir, scratch.case_id)
        FileUtils.mkdir_p(attachments_root)
        att_id = "att_#{SecureRandom.hex(4)}"
        dest_name = name || File.basename(src_path)
        dest = File.join(attachments_root, "#{att_id}_#{dest_name}")
        begin
          FileUtils.cp(src_path, dest)
        rescue StandardError => e
          warn "[kensho] failed to copy #{src_path}: #{e.message}"
          return nil
        end

        guessed_kind, guessed_mime = Kensho::Schema.kind_and_mime_for(src_path)
        rel = relpath(dest, @output_dir)
        record = {
          'id'           => att_id,
          'kind'         => kind || guessed_kind,
          'relativePath' => rel,
          'mimeType'     => mime_type || guessed_mime
        }
        begin
          record['sizeBytes'] = File.size(dest)
        rescue StandardError
          # best-effort
        end
        record
      end

      private

      def build_case(example)
        full_name = example.full_description
        file_path = relpath(example.metadata[:file_path] || example.metadata[:absolute_file_path], @rootpath)
        line = example.metadata[:line_number]

        base_id = Kensho::Schema.stable_case_id(full_name, file_path)
        seen = @ids_seen[base_id]
        case_id = seen.zero? ? base_id : "#{base_id}_#{seen + 1}"
        @ids_seen[base_id] = seen + 1

        suite = collect_suite_chain(example)
        name = example.description.to_s

        meta = example.metadata
        tags = collect_tags(meta)
        labels = collect_labels(meta)
        links = collect_links(meta)
        params = collect_parameters(meta)

        severity = collect_severity(meta) if @severity_from_meta

        behavior = {}
        feature = walk_meta(meta, :kensho_feature) || walk_meta(meta, :feature)
        epic = walk_meta(meta, :kensho_epic) || walk_meta(meta, :epic)
        story = walk_meta(meta, :kensho_story) || walk_meta(meta, :story)
        behavior['feature']  = feature.to_s if feature
        behavior['epic']     = epic.to_s    if epic
        behavior['scenario'] = story.to_s   if story

        owner = meta[:owner]
        description = meta[:kensho_description] || meta[:description_text]

        case_obj = {
          'id'        => case_id,
          'name'      => name,
          'fullName'  => full_name,
          'status'    => 'skip',
          'startedAt' => @started_at,
          'duration'  => 0,
          'retries'   => 0
        }
        case_obj['filePath']    = file_path if file_path
        case_obj['line']        = line.to_i if line
        case_obj['suite']       = suite     unless suite.empty?
        case_obj['tags']        = tags      unless tags.empty?
        case_obj['severity']    = severity  if severity
        case_obj['owner']       = owner.to_s if owner
        case_obj['behavior']    = behavior  unless behavior.empty?
        case_obj['labels']      = labels    unless labels.empty?
        case_obj['links']       = links     unless links.empty?
        case_obj['parameters']  = params    unless params.empty?
        case_obj['description'] = description.to_s if description && !description.to_s.empty?
        case_obj['platform']    = Kensho::Schema.normalize_os
        case_obj
      end

      def finalize(example, status, exception)
        scratch = State.current
        return unless scratch

        case_obj = scratch.instance_variable_get(:@case_obj)
        result = example.execution_result

        started_ms = scratch.started_at_ms
        finished_ms = (result.finished_at || Time.now).to_f * 1000.0
        duration_secs = result.run_time
        duration_ms =
          if duration_secs.is_a?(Numeric)
            (duration_secs * 1000.0).round
          else
            (finished_ms - started_ms).round
          end
        duration_ms = 0 if duration_ms.negative?

        case_obj['status']     = status
        case_obj['startedAt']  = Kensho::Schema.iso_from_seconds(started_ms / 1000.0)
        case_obj['finishedAt'] = Kensho::Schema.iso_from_seconds(finished_ms / 1000.0)
        case_obj['duration']   = duration_ms

        # Pending/skip messages from RSpec become a log entry so the report
        # surfaces the reason.
        if status == 'skip' && result.pending_message
          case_obj['logs'] ||= []
          case_obj['logs'] << { 't' => 0, 'level' => 'info', 'msg' => result.pending_message.to_s }
        end

        if exception
          err = { 'message' => first_line(exception.message.to_s) || exception.class.name.to_s }
          stack_text = format_exception(exception)
          err['stack'] = stack_text if stack_text && !stack_text.empty?
          err['type']  = exception.class.name.to_s
          case_obj['errors'] = [err]
        end

        # Auto-close any steps the user forgot to exit. Mark them broken so
        # the report makes the leak visible.
        until scratch.step_stack.empty?
          leaked = scratch.step_stack.pop
          leaked['status'] ||= 'broken'
          leaked['duration'] ||= 0
          leaked.delete('_started_perf')
        end

        case_obj['steps']       = scratch.steps       unless scratch.steps.empty?
        case_obj['attachments'] = scratch.attachments unless scratch.attachments.empty?
        if !scratch.labels.empty?
          existing = case_obj['labels'] || {}
          case_obj['labels'] = existing.merge(scratch.labels)
        end
        if !scratch.links.empty?
          existing = case_obj['links'] || []
          case_obj['links'] = existing + scratch.links
        end

        # Stdout/stderr captured by RSpec is wired up by an around-each
        # hook (see Kensho::RSpec::Formatter.install_capture_hook) — see
        # below.
        captured_stdout = scratch.instance_variable_get(:@stdout_text)
        captured_stderr = scratch.instance_variable_get(:@stderr_text)
        capture_logs = []
        if captured_stdout && !captured_stdout.empty?
          captured_stdout.each_line { |ln| capture_logs << { 't' => 0, 'level' => 'info', 'msg' => ln.rstrip } }
        end
        if captured_stderr && !captured_stderr.empty?
          captured_stderr.each_line { |ln| capture_logs << { 't' => 0, 'level' => 'warn', 'msg' => ln.rstrip } }
        end
        unless capture_logs.empty?
          case_obj['logs'] = (case_obj['logs'] || []) + capture_logs
        end

        write_case(case_obj)
      ensure
        State.current = nil
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
        duration_ms = [((monotonic_now - @started_perf) * 1000.0).round, 0].max
        framework_version = (defined?(::RSpec::Core::Version) ? ::RSpec::Core::Version::STRING : 'unknown')

        run = {
          'schemaVersion' => Kensho::Schema::SCHEMA_VERSION,
          'id'            => @run_id,
          'project'       => @project,
          'framework'     => { 'name' => 'rspec', 'version' => framework_version },
          'env'           => Kensho::Schema.env_info(framework_version: framework_version),
          'startedAt'     => @started_at,
          'finishedAt'    => finished_at,
          'totals'        => totals,
          'durationMs'    => duration_ms,
          'testCases'     => cases
        }
        File.write(File.join(@output_dir, 'run.json'), JSON.pretty_generate(run))
      rescue StandardError => e
        warn "[kensho] failed to write run.json: #{e.message}"
      end

      # ----- metadata extraction ----- #

      def collect_severity(meta)
        sev = meta[:severity]
        return sev.to_s if sev.is_a?(String) && Kensho::Schema::SEVERITY.include?(sev.to_s)
        return sev.to_s if sev.is_a?(Symbol) && Kensho::Schema::SEVERITY.include?(sev.to_s)

        # `it 'foo', :critical do ... end` style — RSpec stores those as
        # `meta[:critical] = true`.
        SEVERITY_KEYS.each do |key|
          return key.to_s if meta[key] == true
        end
        # `severity_blocker: true` style.
        SEVERITY_KEYS.each do |key|
          composite = "severity_#{key}".to_sym
          return key.to_s if meta[composite] == true
        end
        nil
      end

      def collect_tags(meta)
        tags = []
        meta.each do |k, v|
          next if META_BLOCKLIST.include?(k)
          next if k.to_s.start_with?('rerun_', 'shared_', 'kensho_')

          if v == true && k.is_a?(Symbol)
            next if SEVERITY_KEYS.include?(k)

            tags << k.to_s
          end
        end
        # `tags: [...]` explicit array.
        if meta[:tags].is_a?(Array)
          meta[:tags].each { |t| tags << t.to_s unless tags.include?(t.to_s) }
        end
        tags
      end

      def collect_labels(meta)
        labels = {}
        if meta[:kensho_labels].is_a?(Hash)
          meta[:kensho_labels].each { |k, v| labels[k.to_s] = v.to_s unless v.nil? }
        end
        labels
      end

      def collect_links(meta)
        links = []
        raw = meta[:kensho_links]
        Array(raw).each do |entry|
          case entry
          when Hash
            url = entry[:url] || entry['url']
            next unless url

            link = { 'url' => url.to_s }
            kind = entry[:kind] || entry['kind']
            label = entry[:label] || entry['label']
            link['kind']  = kind.to_s  if kind
            link['label'] = label.to_s if label
            links << link
          when String
            links << { 'url' => entry }
          end
        end
        links
      end

      def collect_parameters(meta)
        params = []
        # rspec-parameterized's with_them puts data row in :variants.
        if meta[:variants].is_a?(Hash)
          meta[:variants].each do |k, v|
            params << { 'name' => k.to_s, 'value' => stringify(v), 'kind' => 'data-row' }
          end
        end
        # Conventional `it 'does X', params: { foo: 1 } do` shape.
        if meta[:params].is_a?(Hash)
          meta[:params].each do |k, v|
            next if params.any? { |p| p['name'] == k.to_s }

            params << { 'name' => k.to_s, 'value' => stringify(v), 'kind' => 'argument' }
          end
        end
        params
      end

      def collect_group_meta(group)
        m = group.metadata
        {
          feature: m[:kensho_feature] || m[:feature],
          epic:    m[:kensho_epic]    || m[:epic],
          story:   m[:kensho_story]   || m[:story]
        }
      end

      def walk_meta(meta, key)
        return meta[key] if meta[key]

        parent = meta[:parent_example_group]
        return nil unless parent

        walk_meta(parent, key)
      end

      def collect_suite_chain(example)
        chain = []
        group = example.example_group
        if group.respond_to?(:parent_groups)
          # parent_groups[0] is `group` itself, last is the outermost group.
          group.parent_groups.each do |g|
            desc = g.metadata[:description]
            chain.unshift(desc.to_s) if desc && !desc.to_s.empty?
          end
        else
          desc = group.metadata[:description]
          chain << desc.to_s if desc
        end
        chain
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

      def stringify(v)
        case v
        when String then v
        when Symbol then v.to_s
        when Numeric, TrueClass, FalseClass, NilClass then v.inspect
        else
          begin
            v.inspect
          rescue StandardError
            '<unrepr>'
          end
        end
      end

      def format_exception(exception)
        return nil unless exception

        lines = [exception.message.to_s]
        if exception.backtrace
          lines.concat(exception.backtrace.first(20))
        end
        lines.join("\n")
      end

      def first_line(s)
        return nil unless s

        s.to_s.each_line do |line|
          stripped = line.strip
          return stripped unless stripped.empty?
        end
        nil
      end

      def monotonic_now
        Process.clock_gettime(Process::CLOCK_MONOTONIC)
      end
    end
  end
end
