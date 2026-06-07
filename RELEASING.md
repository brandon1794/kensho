# Releasing Kensho

Kensho ships as packages on public registries so people can `pnpm add` /
`pip install` / Maven-depend on them. This doc covers the **npm** track (the
16 JS/TS packages + the `kensho` CLI + viewer), which is live and automated.
PyPI and Maven Central are tracked at the bottom as follow-ups.

## npm — one-time setup (Trusted Publishing / OIDC, no token)

`release.yml` publishes via **npm Trusted Publishing** — authentication is the
workflow's OIDC id-token, so there is **no `NPM_TOKEN` to manage**. Setup, per
package (npmjs.com → the package → **Settings → Trusted Publisher → GitHub
Actions**):

- Organization or user: `brandon1794`
- Repository: `kensho`
- Workflow filename: `release.yml`
- Environment: (leave blank)

Do this for all 16 packages (the 15 `@kaizenreport/kensho-*` + `newman-reporter-kensho`).
Once configured you can delete any old `NPM_TOKEN` secret.

**Constraint:** keep pnpm on **10.x** (`packageManager` pins `pnpm@10.28.0`) —
pnpm 11 has an OIDC publish regression (404). Provenance is automatic under
trusted publishing.

## npm — cutting a release

1. **Bump versions.** Every package is currently `0.1.0`. Bump the ones you're
   releasing (keep them in lockstep unless you have a reason not to):
   ```bash
   # from repo root — bumps all public Kensho packages to the same version
   pnpm --filter "./packages/**" exec npm version 0.1.1 --no-git-tag-version
   ```
2. **Commit** the version bumps.
3. **Tag and push** — this fires `.github/workflows/release-kensho.yml`:
   ```bash
   git tag kensho-v0.1.1
   git push origin kensho-v0.1.1
   ```
4. The workflow installs, builds the viewer, and runs
   `pnpm --filter "./packages/**" publish --access public` with
   **provenance** (the `id-token` permission attaches a signed link from the
   package back to this repo + commit). Private packages (apps, examples) are
   skipped automatically. Already-published versions are skipped, so re-running a
   tag is safe.

### Verify a release

```bash
npm view @kaizenreport/kensho version
npm view @kaizenreport/kensho-playwright version
# Fresh-install smoke test in a throwaway dir:
mkdir /tmp/kensho-smoke && cd /tmp/kensho-smoke && npm init -y
npm i -D @kaizenreport/kensho-playwright @kaizenreport/kensho
npx kensho version
```

### Notes / gotchas

- **`pnpm publish`, never `npm publish`.** Adapters use `workspace:*` for
  `@kaizenreport/kensho-schema`; pnpm rewrites that to the real version at pack
  time. Plain npm would publish a literal `workspace:*` and break installs.
- **Dry run before a big release:**
  `pnpm --filter "./packages/**" publish --dry-run --no-git-checks`
  prints the tarball contents per package without uploading.
- **`files` whitelist** controls what ships. If you add a runtime file to a
  package, add it to that package's `package.json#files`.

## PyPI — `kensho-pytest` (automated via `release-pypi.yml`)

`release-pypi.yml` builds + publishes `kensho-pytest` on every `v*` tag via
**Trusted Publishing** (OIDC, no token). One-time setup on PyPI (→ Publishing →
**Add a pending publisher**):

- PyPI Project Name: `kensho-pytest`
- Owner: `brandon1794`
- Repository name: `kensho`
- Workflow name: `release-pypi.yml`
- Environment: (leave blank)

To also ship `kensho-robot`, add a second `pypi-robot` job pointing at
`packages/robot` and register a matching pending publisher for `kensho-robot`.

## Maven Central — follow-up (junit5, testng, cucumber-jvm)

`groupId` is `com.kaizenreport`. To ship:
1. Register the namespace at central.sonatype.com and **verify it** via a DNS
   TXT record on `kaizenreport.com` (you already own the domain).
2. Create a GPG signing key, publish the public key to a keyserver, store the
   private key + passphrase as CI secrets.
3. Add a release job using the Central Publishing Maven Plugin (`mvn deploy`).

## NuGet (.NET) / RubyGems (Ruby) — lower priority

Manifests exist (`KaizenReport.Kensho.*` / `kensho-*.gemspec`). Same shape:
registry account → API key as a CI secret → `dotnet nuget push` /
`gem push` job on tag.
