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

## Maven Central — junit5, testng, cucumber-jvm (`release-maven.yml`, manual)

The 3 poms (`groupId com.kaizenreports`) carry a `release` profile (sources +
javadoc + GPG sign + Central Portal plugin). `release-maven.yml` runs
`mvn -Prelease deploy` for each. Maven Central has **no OIDC**, so this is a
**manual** workflow (Actions tab → "Release (Maven Central)" → Run) gated on
real credentials — it's deliberately off the `v*` tag so it never fails the
npm/PyPI release.

One-time setup (account owner):
1. **Verify the namespace.** central.sonatype.com → Namespaces → add
   `com.kaizenreports` → verify via the **DNS TXT** record it gives you on
   `kaizenreports.com` (you own it, DNS on Cloudflare).
2. **GPG key.** `gpg --gen-key`; publish the public key:
   `gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>`. Export the private
   key: `gpg --armor --export-secret-keys <KEYID>`.
3. **Central Portal token.** central.sonatype.com → Account → Generate User Token.
4. **Add repo secrets:** `CENTRAL_USERNAME`, `CENTRAL_PASSWORD` (the token),
   `MAVEN_GPG_PRIVATE_KEY` (armored private key), `MAVEN_GPG_PASSPHRASE`.
5. Bump the 3 pom `<version>`s, commit, then run the workflow from the Actions tab.

> Untested in CI until those secrets exist — the GPG/passphrase wiring is the
> usual fiddly part; first run may need a tweak.

## NuGet (.NET) — `release-nuget.yml` (manual)

Publishes `KaizenReport.Kensho.{Core,NUnit,MSTest,Xunit}`. Core is packed/pushed
first (the adapters ProjectReference it). API-key based (no OIDC), so it's a
manual `workflow_dispatch`.

One-time setup:
1. nuget.org account → **API Keys → Create** (scope: Push; glob `KaizenReport.Kensho.*` or all).
2. `gh secret set NUGET_API_KEY --repo brandon1794/kensho`
3. Actions → **Release (NuGet)** → Run.

## RubyGems (Ruby) — `release-rubygems.yml` (manual, Trusted Publishing)

Publishes `kensho-rspec`, `kensho-cucumber-ruby` via **OIDC trusted publishing**
(no API key, no MFA hassle).

One-time setup — add a **Pending Trusted Publisher** for EACH gem
(rubygems.org → Trusted Publishers → Create):
- Gem name `kensho-rspec` · Repository `brandon1794/kensho` · Workflow
  `release-rubygems.yml` · Environment (blank)
- Repeat for `kensho-cucumber-ruby`.

Then Actions → **Release (RubyGems)** → Run. No secret needed.

> Both are untested in CI until the keys exist — first run may need a small tweak
> (same as Maven). Versions are bumped to 0.1.1 to match the other ecosystems.
