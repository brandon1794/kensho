# frozen_string_literal: true

# Vendored slice of the Kensho v1 schema contract.
#
# We deliberately do not depend on the JS @kaizenreport/kensho-schema package.
# Adapters need to stay tiny and standalone, so we re-implement the few things
# the formatter cares about: the stable case-id hash, the status enum, the
# attachment kind/MIME tables, and the environment-capture function.

require 'rbconfig'

module Kensho
  module Schema
    SCHEMA_VERSION = 'kensho/v1'

    STATUS = %w[pass fail broken skip].freeze
    STEP_STATUS = %w[pass fail skip].freeze
    SEVERITY = %w[blocker critical normal minor trivial].freeze
    ATTACHMENT_KINDS = %w[
      screenshot video trace har text json html dom-snapshot log
    ].freeze

    MIME_BY_EXT = {
      '.png'  => 'image/png',
      '.jpg'  => 'image/jpeg',
      '.jpeg' => 'image/jpeg',
      '.webp' => 'image/webp',
      '.webm' => 'video/webm',
      '.mp4'  => 'video/mp4',
      '.zip'  => 'application/zip',
      '.html' => 'text/html',
      '.json' => 'application/json',
      '.txt'  => 'text/plain',
      '.log'  => 'text/plain',
      '.har'  => 'application/json'
    }.freeze

    KIND_BY_EXT = {
      '.png'  => 'screenshot',
      '.jpg'  => 'screenshot',
      '.jpeg' => 'screenshot',
      '.webp' => 'screenshot',
      '.webm' => 'video',
      '.mp4'  => 'video',
      '.zip'  => 'trace',
      '.html' => 'html',
      '.json' => 'json',
      '.txt'  => 'text',
      '.log'  => 'log',
      '.har'  => 'har'
    }.freeze

    FNV_OFFSET_1 = 0x811c9dc5
    FNV_OFFSET_2 = 0x01000193
    FNV_PRIME_1  = 0x01000193
    FNV_PRIME_2  = 0x85ebca6b
    MASK32       = 0xffffffff

    # Mirrors stableCaseId from packages/schema/index.js byte-for-byte:
    # double FNV-1a with two different secondary primes so the two 32-bit
    # chunks come from independent rolling states. Must stay byte-compatible
    # with the JS implementation or test history won't line up across
    # adapters.
    def self.stable_case_id(full_name, file_path)
      s = "#{full_name || ''}::#{file_path || ''}"
      h1 = FNV_OFFSET_1
      h2 = FNV_OFFSET_2
      s.each_codepoint do |c|
        h1 = ((h1 ^ c) * FNV_PRIME_1) & MASK32
        h2 = ((h2 ^ c) * FNV_PRIME_2) & MASK32
      end
      format('tc_%08x%08x', h1, h2)
    end

    def self.kind_and_mime_for(path)
      ext = File.extname(path.to_s).downcase
      [KIND_BY_EXT[ext] || 'text', MIME_BY_EXT[ext] || 'application/octet-stream']
    end

    def self.normalize_os
      host = RbConfig::CONFIG['host_os'].to_s.downcase
      return 'linux'  if host.include?('linux')
      return 'darwin' if host.include?('darwin')
      return 'win32'  if host.include?('mswin') || host.include?('mingw') || host.include?('cygwin')

      host
    end

    # Normalize SSH-style git URLs to https. ``git@github.com:foo/bar.git``
    # becomes ``https://github.com/foo/bar``; trailing ``.git`` is dropped.
    def self.normalize_git_url(u)
      return nil if u.nil? || u.empty?

      m = u.match(%r{^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\.git)?$})
      return "https://#{m[1]}/#{m[2]}" if m

      u.sub(/\.git\z/, '')
    end

    # CI / environment metadata for run.env. Matches the helpers in the JS
    # adapters so a Kensho report looks the same regardless of language.
    def self.env_info(framework_version: nil)
      ci_env = ENV['CI']
      ci =
        if ci_env && ENV['GITHUB_ACTIONS']
          'github-actions'
        elsif ci_env && ENV['CIRCLECI']
          'circleci'
        elsif ci_env && ENV['GITLAB_CI']
          'gitlab'
        elsif ci_env && ENV['JENKINS_URL']
          'jenkins'
        elsif ci_env && ENV['BUILDKITE']
          'buildkite'
        elsif ci_env && ENV['TF_BUILD']
          'azure-devops'
        elsif ci_env
          'unknown'
        else
          'local'
        end

      branch = ENV['GITHUB_REF_NAME'] || ENV['CIRCLE_BRANCH'] ||
               ENV['CI_COMMIT_REF_NAME'] || ENV['BUILDKITE_BRANCH']
      commit = ENV['GITHUB_SHA'] || ENV['CIRCLE_SHA1'] ||
               ENV['CI_COMMIT_SHA'] || ENV['BUILDKITE_COMMIT']
      author = ENV['KR_AUTHOR'] || ENV['GITHUB_ACTOR']
      commit_msg = ENV['KR_COMMIT_MSG']

      run_url = ENV['KR_RUN_URL'] ||
        if ENV['GITHUB_SERVER_URL'] && ENV['GITHUB_REPOSITORY'] && ENV['GITHUB_RUN_ID']
          "#{ENV['GITHUB_SERVER_URL']}/#{ENV['GITHUB_REPOSITORY']}/actions/runs/#{ENV['GITHUB_RUN_ID']}"
        elsif ENV['CIRCLE_BUILD_URL']
          ENV['CIRCLE_BUILD_URL']
        elsif ENV['CI_JOB_URL']
          ENV['CI_JOB_URL']
        elsif ENV['BUILD_URL']
          ENV['BUILD_URL']
        elsif ENV['BUILDKITE_BUILD_URL']
          ENV['BUILDKITE_BUILD_URL']
        end

      # repoUrl — KR_REPO_URL override → GitHub Actions / GitLab / Bitbucket /
      # Azure / SSH-style URLs from CircleCI / Buildkite / Jenkins (normalized).
      gh_server = ENV['GITHUB_SERVER_URL']
      gh_repo   = ENV['GITHUB_REPOSITORY']
      repo_url = ENV['KR_REPO_URL'] ||
                 (gh_server && gh_repo ? "#{gh_server}/#{gh_repo}" : nil) ||
                 ENV['CI_PROJECT_URL'] ||
                 ENV['BITBUCKET_GIT_HTTP_ORIGIN'] ||
                 normalize_git_url(ENV['BUILD_REPOSITORY_URI']) ||
                 normalize_git_url(ENV['CIRCLE_REPOSITORY_URL'] ||
                                   ENV['BUILDKITE_REPO'] ||
                                   ENV['GIT_URL'])

      info = {
        'ci' => ci,
        'os' => normalize_os,
        'arch' => RbConfig::CONFIG['host_cpu'].to_s
      }

      ruby_version = "#{RUBY_VERSION}p#{defined?(RUBY_PATCHLEVEL) ? RUBY_PATCHLEVEL : '0'}"
      info['vars'] = { 'rubyVersion' => ruby_version }
      info['vars']['frameworkVersion'] = framework_version if framework_version

      info['branch']     = branch     if branch
      info['commit']     = commit     if commit
      info['commitMsg']  = commit_msg if commit_msg
      info['author']     = author     if author
      info['runUrl']     = run_url    if run_url
      info['repoUrl']    = repo_url   if repo_url
      os_version = RbConfig::CONFIG['host_os']
      info['osVersion'] = os_version if os_version

      [
        ['KR_STAGE', 'stage'],
        ['KR_BASE_URL', 'baseUrl'],
        ['KR_APP_VERSION', 'appVersion'],
        ['KR_BUILD_NUMBER', 'buildNumber'],
        ['KR_RELEASE', 'release'],
        ['KR_REGION', 'region'],
        ['KR_LOCALE', 'locale'],
        ['KR_TRIGGER', 'trigger'],
        ['KR_FEATURE', 'feature']
      ].each do |env_var, key|
        v = ENV[env_var]
        info[key] = v if v && !v.empty?
      end

      info
    end

    def self.iso_now
      Time.now.utc.strftime('%Y-%m-%dT%H:%M:%S.%LZ')
    end

    def self.iso_from_seconds(secs)
      Time.at(secs).utc.strftime('%Y-%m-%dT%H:%M:%S.%LZ')
    end

    def self.slugify(name)
      s = name.to_s.downcase.strip
      s = s.gsub(/[^a-z0-9_-]+/, '-').gsub(/\A-+|-+\z/, '')
      s.empty? ? 'unknown' : s
    end

    def self.default_run_id
      "run_#{Time.now.utc.strftime('%Y%m%d%H%M%S')}"
    end
  end
end
