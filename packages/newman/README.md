# newman-reporter-kensho

A [Newman](https://github.com/postmanlabs/newman) custom reporter that emits
[Kensho v1](../schema) JSON. The Kensho viewer's HTTP step UI (request /
response panes, headers, status badges) lights up automatically because every
Postman item becomes a Kensho case with `step.request` / `step.response`
populated.

## Install

```bash
pnpm add -D newman-reporter-kensho @kaizenreport/kensho
```

(The package is published as `newman-reporter-kensho` so Newman's `-r kensho`
flag discovers it. The canonical alias is `@kaizenreport/kensho-newman`.)

## Run

```bash
newman run collection.json -r kensho
npx kensho generate
npx kensho open
```

## What we capture

| Postman / Newman concept                      | Kensho field                                       |
| --------------------------------------------- | -------------------------------------------------- |
| Collection name                               | `case.behavior.epic` (and `project.name` default)  |
| Folder name                                   | `case.behavior.feature`, `case.suite[]`            |
| Item name                                     | `case.name`, `case.behavior.scenario`              |
| Request (`HTTP method` + URL + body + headers) | `step.request{}` on a per-item HTTP step          |
| Response (status, body, headers, size, duration) | `step.response{}` on the same step               |
| Each `pm.test(...)` assertion                 | sub-step under the request with `step.assertion{}` |
| Folder name like `@blocker/Auth`              | `case.severity = 'blocker'`                        |
| `pm.environment.set('kensho_severity','critical')` (pre-request) | `case.severity`                |
| `pm.environment.set('kensho_tags','smoke api')` (pre-request)    | merged into `case.tags[]`      |
| `console.log/warn/error` from sandbox         | `case.logs[]`                                      |
| 5xx with no assertion failure                 | `case.status = 'broken'`                           |
| Failing assertion                             | `case.status = 'fail'`                             |
| Skipped (`pm.execution.skipRequest()`)        | `case.status = 'skip'`                             |

Stable ids hash `fullName + 'collection://<name>'` so the same item across
iterations is correlated on the platform.

## Reporter options

```bash
newman run collection.json -r kensho \
  --reporter-kensho-output kensho-results \
  --reporter-kensho-projectName "Acme API" \
  --reporter-kensho-projectSlug "acme-api"
```

Or via env: `KENSHO_OUTPUT`, `KENSHO_PROJECT_NAME`, `KENSHO_PROJECT_SLUG`.

## Tagging conventions

```text
Collection
└── @blocker / Auth          ← folder name → severity blocker for everything inside
    ├── login @critical       ← item name → severity critical, tag 'critical'
    └── refresh-token @smoke  ← tag 'smoke'
```

For free-form labels, use a pre-request script:

```js
pm.environment.set('kensho_severity', 'critical');
pm.environment.set('kensho_tags', 'smoke regression');
```
