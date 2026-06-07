# @kaizenreport/kensho-xcuitest

Kensho adapter for native iOS XCUITest — converts an `.xcresult` bundle from `xcodebuild test` into `kensho-results/` so the Kensho CLI can build a static report.

## Platform requirement

`.xcresult` bundles are an Apple-proprietary format. Parsing them requires **macOS + Xcode Command Line Tools** (the `xcrun xcresulttool` binary).

For non-mac CI runners, generate the JSON dump on the mac side once and ship it through:

```bash
# on macOS:
xcrun xcresulttool get --format json --path ./out.xcresult > out.xcresult.json
# anywhere:
npx kensho-xcuitest --input out.xcresult.json --output kensho-results
```

## Install

```bash
pnpm add -D @kaizenreport/kensho-xcuitest @kaizenreport/kensho
```

## Use

```bash
xcodebuild -scheme AcmeUITests \
           -destination 'platform=iOS Simulator,name=iPhone 15,OS=17.4' \
           test -resultBundlePath ./out.xcresult

npx kensho-xcuitest --input ./out.xcresult --output ./kensho-results
npx kensho validate ./kensho-results
npx kensho generate --input ./kensho-results --output ./kensho-report
npx kensho open --report ./kensho-report
```

## What gets captured

| `xcresulttool` field                                     | Kensho field                        |
| -------------------------------------------------------- | ----------------------------------- |
| `ActionTestSummary.name`                                 | `case.name`                         |
| `ActionTestSummary.identifier` + parent group names      | `case.fullName` / `case.suite[]`    |
| `documentLocationInCreatingWorkspace.url`                | `case.filePath` + `case.line`       |
| `testStatus` (`Success`/`Failure`/`ExpectedFailure`/`Skipped`) | `case.status` (`pass`/`fail`/`broken`/`skip`) |
| `duration` (seconds)                                     | `case.duration` (ms)                |
| `activitySummaries[]` (recursive)                        | `case.steps[]` (with sub-steps)     |
| `activitySummaries[].attachments[]`                      | `case.steps[].attachments[]`        |
| `failureSummaries[]`                                     | `case.errors[]`                     |
| `runDestination.targetDeviceRecord.modelName`            | `run.env.device`                    |
| `runDestination.targetDeviceRecord.operatingSystemVersion` | `run.env.osVersion`               |
| `testableSummaries[].targetName`                         | `case.labels.target`                |

`framework.name = 'xcuitest'`. Status mapping:
- `Success` → `pass`
- `Failure` → `fail`
- `ExpectedFailure` → `broken`
- `Skipped` → `skip`

## Notes on attachments

Real `.xcresult` bundles store screenshots/videos inside the bundle as referenced blobs. The adapter calls `xcrun xcresulttool export --type file --id <ref>` to pull each one out into `kensho-results/attachments/<caseId>/`.

When running on a fixture JSON dump (no real bundle next to it), the adapter writes a small placeholder file so the case still references something — the schema requires `relativePath` to point at a file on disk.
