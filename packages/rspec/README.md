# kensho-rspec

An RSpec 3+ formatter that emits the canonical [Kensho v1](../schema) JSON
format. Run your spec, point the `kensho` CLI at `kensho-results/`, and
get a self-contained static HTML report.

## Install

```ruby
# Gemfile
gem 'kensho-rspec', require: false, group: :test
```

```bash
bundle install
```

## Run

```bash
# minimal — adds the formatter alongside whatever you already use
bundle exec rspec --format Kensho::RSpec::Formatter

# combine with the default progress formatter
bundle exec rspec --format documentation --format Kensho::RSpec::Formatter

# render the HTML report (uses the JS CLI from the same monorepo):
npx kensho generate
npx kensho open
```

You can also pin the formatter from `.rspec`:

```
--require kensho/rspec
--format Kensho::RSpec::Formatter
--format documentation
```

## What it produces

- `kensho-results/run.json` — run manifest (project, env, totals, timing).
- `kensho-results/cases/<stableId>.json` — one file per example.
- `kensho-results/attachments/<caseId>/...` — files registered via `Kensho.attach`.

Each case gets a **stable id** (`tc_<16 hex>`) hashed from its full
description + file path so test history correlates across runs and
across adapters (the JS adapters use the same FNV-1a-based hash).

## Metadata we read

| Metadata                                       | Effect                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| `it 'foo', severity: :critical do`             | Sets `case.severity`. Allowed: `blocker`, `critical`, `normal`, `minor`, `trivial`. |
| `it 'foo', :critical do`                       | Symbol shorthand. Same five severity names work.          |
| `it 'foo', severity_blocker: true do`          | Long-form alias.                                          |
| `Kensho::Feature('Cart')` (inside `describe`)  | Sets `case.behavior.feature`.                             |
| `Kensho::Epic('Checkout')`                     | Sets `case.behavior.epic`.                                |
| `Kensho::Story('Empty cart shows CTA')`        | Sets `case.behavior.scenario`.                            |
| `it 'foo', owner: 'alice' do`                  | Sets `case.owner`.                                        |
| `it 'foo', kensho_labels: { team: 'cart' } do` | Free-form `key=value` → `case.labels`.                    |
| `it 'foo', kensho_links: [{ kind: 'jira', url: '…', label: 'PROJ-123' }]` | Adds entries to `case.links`. |
| Any other symbol metadata (e.g. `:smoke`)      | Becomes a tag on `case.tags`.                             |
| `it 'foo', tags: %w[smoke regression]`         | Adds explicit tags.                                       |
| `with_them` rows (rspec-parameterized)         | Each row's variables → `case.parameters[]`.               |

```ruby
require 'kensho/rspec'

RSpec.describe 'Cart' do
  Kensho::Feature('Cart')
  Kensho::Epic('Checkout')

  it 'totals correctly', :critical, owner: 'alice',
     kensho_labels: { team: 'growth' },
     kensho_links: [{ kind: 'jira', url: 'https://jira.example.com/browse/PROJ-123', label: 'PROJ-123' }] do
    expect(1 + 1).to eq(2)
  end
end
```

## Helper API

```ruby
require 'kensho/rspec'

RSpec.describe 'Login' do
  it 'submits credentials' do
    Kensho.step('open the login page') do
      visit '/login'
    end

    Kensho.step('submit credentials') do
      fill_in 'user', with: 'demo'
      click_button 'Sign in'

      Kensho.step('verify redirect') do
        expect(page.current_url).to end_with('/home')
      end
    end

    Kensho.label('team', 'growth')
    Kensho.link('https://jira.example.com/browse/PROJ-123',
                kind: 'jira', label: 'PROJ-123')

    page.save_screenshot('/tmp/login.png')
    Kensho.attach('/tmp/login.png', kind: 'screenshot')
  end
end
```

| Helper                                          | What it does                                            |
| ----------------------------------------------- | ------------------------------------------------------- |
| `Kensho.step(title, action: nil) { ... }`       | Opens a Kensho step, nesting automatically. On exception the step is marked `fail` and the exception re-raises. |
| `Kensho.attach(path, kind: nil, name: nil, mime_type: nil)` | Copies the file into `kensho-results/attachments/<caseId>/` and registers it on the current case (or current step if one is open). |
| `Kensho.label(key, value)`                      | Adds a string label to the case.                        |
| `Kensho.link(url, kind: nil, label: nil)`       | Adds a hyperlink to the case.                           |
| `Kensho.current_case_id`                        | Returns the stable case id of the running test, or `nil`. |

All five are no-ops outside a running example.

## Captured stdout / stderr → logs

Every `puts` (or `$stderr.write`) the example emits is captured and
forwarded into `case.logs[]`. The `t` field is currently always `0`
(per-line offsets are coming).

## Status mapping

| RSpec outcome              | Kensho status |
| -------------------------- | ------------- |
| passed                     | `pass`        |
| failed (Expectation error) | `fail`        |
| failed (other exception)   | `broken`      |
| pending / skipped          | `skip`        |

A pending example's `pending_message` becomes the first entry in
`case.logs[]`.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite, Azure DevOps —
CI provider, branch, commit, run URL, OS, architecture, Ruby version.

Pass `KR_AUTHOR`, `KR_COMMIT_MSG`, `KR_STAGE`, `KR_BASE_URL`,
`KR_APP_VERSION`, `KR_BUILD_NUMBER`, `KR_RELEASE`, `KR_REGION`,
`KR_LOCALE`, `KR_TRIGGER`, or `KR_FEATURE` as env vars to populate the
matching fields on `run.env`.

## CLI / env flags

There is no formatter-options DSL because RSpec doesn't pass formatter
arguments through reliably across versions. Configuration goes through
env vars:

```
KENSHO_OUTPUT                 output dir (default ./kensho-results)
KENSHO_PROJECT_NAME           project name in run.json
KENSHO_PROJECT_SLUG           project slug
KENSHO_RUN_ID                 override the auto-generated run id
KENSHO_NO_SEVERITY_FROM_META  set to "1" to disable severity-from-meta
```

## Design notes

- Zero runtime dependencies beyond `rspec-core` itself. The schema lives
  in the JS workspace; we vendor the minimum (id-hashing, status
  mapping, env capture) inline so the gem installs in seconds.
- The formatter never raises out of a hook — a broken adapter must not
  break a test run.
- IDs are stable across adapters: the FNV-1a hash matches the JS
  `stableCaseId` byte-for-byte, so `rspec` and `playwright` runs of the
  same suite roll up to the same history on the platform.

## License

Apache-2.0.
