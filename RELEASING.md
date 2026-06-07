# Releasing Kensho

Kensho ships as packages on public registries so people can `pnpm add` /
`pip install` / Maven-depend on them. This doc covers the **npm** track (the
16 JS/TS packages + the `kensho` CLI + viewer), which is live and automated.
PyPI and Maven Central are tracked at the bottom as follow-ups.

## npm — one-time setup (account owner)

These need your npm identity and can't be scripted:

1. **Create the org.** On npmjs.com, create the `@kaizenreport` organization
   (Free plan is fine for public packages). Every scoped package
   (`@kaizenreport/kensho-*`) publishes under it; `newman-reporter-kensho` is
   unscoped by convention (Postman's reporter naming) and just needs your account
   to own the name.
2. **Mint a token.** npmjs.com → Access Tokens → **Generate New Token →
   Automation** (bypasses 2FA in CI). Copy it.
3. **Add the CI secret.** GitHub repo → Settings → Secrets and variables →
   Actions → New repository secret named **`NPM_TOKEN`**.

That's it — everything below is automated.

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

## PyPI — follow-up (pytest, robot)

Packages exist (`kensho-pytest`, `kensho-robot`). To ship:
1. Create the projects on PyPI (confirm the names are free first).
2. Configure **Trusted Publishing** (OIDC) for this repo — no token to store.
3. Add a `release-kensho-pypi.yml` that builds sdist+wheel (`python -m build`)
   and publishes via `pypa/gh-action-pypi-publish` on the same tag.

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
