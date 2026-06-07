# newman-demo

End-to-end demo of [`newman-reporter-kensho`](../../packages/newman). The
collection hits `httpbin.org` so it works without standing up a server.

## Run with real Newman

```bash
pnpm install
pnpm test
pnpm run validate
pnpm run generate
pnpm run open
```

`pnpm test` runs:

```bash
newman run collection.json -r kensho \
  --reporter-kensho-projectName 'Acme API' \
  --reporter-kensho-projectSlug acme-api
```

## Run without Newman / network

The seed script feeds canned events directly into the reporter:

```bash
pnpm run seed
pnpm run validate
pnpm run generate
```

You'll get the same `kensho-results/` shape: 3 cases (one each for the
Auth/login, Catalog/GET products, Catalog/GET 404 items), the third intentionally
fails its assertion to demo the assertion sub-step.

## What the demo proves

* Folder name `@critical/Auth` → severity `critical` propagated to every item
  inside the folder.
* Each item becomes a Kensho case with `behavior.epic = collection name`,
  `behavior.feature = folder name`, `behavior.scenario = item name`.
* The HTTP request fires a `step.request{}` + `step.response{}` so the viewer
  renders the request/response panes.
* `pm.test(...)` assertions become `step.assertion` sub-steps under the
  request — failing assertions render the expected/received diff.
* 5xx with no assertion → `case.status = 'broken'`. Failing assertion →
  `case.status = 'fail'`. Skipped item → `case.status = 'skip'`.
