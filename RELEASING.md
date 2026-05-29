# Releasing SQL Sentinel

SQL Sentinel ships as a signed Windows installer and updates itself in the
background via **GitHub Releases** (`electron-updater`). This document covers how
to cut a release and how code signing is wired.

## TL;DR — cut a release

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit to a green `master` (CI must be passing).
3. Tag and push:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) builds, signs, and
   publishes the installer + `latest.yml` to a GitHub Release for that tag.

Installed clients check for updates on launch and every 6 hours, download in the
background, and install on the next quit.

## Required GitHub secrets

| Secret | Purpose | Notes |
| --- | --- | --- |
| `GITHUB_TOKEN` | Publish the Release + assets | Auto-provided; the workflow grants `contents: write`. |
| `WIN_CSC_LINK` | Windows signing certificate | **Base64** of the `.pfx`. Leave empty to build unsigned. |
| `WIN_CSC_KEY_PASSWORD` | Password for the `.pfx` | Leave empty to build unsigned. |

Until `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` are set, the workflow still runs but
produces an **unsigned** installer. Unsigned builds trip Windows SmartScreen and
**fail auto-update signature verification**, so sign before relying on updates.

### Encoding the certificate

```bash
# produces the value for the WIN_CSC_LINK secret
base64 -w0 sqlsentinel-codesign.pfx        # Linux/macOS
[Convert]::ToBase64String([IO.File]::ReadAllBytes("sqlsentinel-codesign.pfx"))  # PowerShell
```

Add both values under **Settings → Secrets and variables → Actions**.

### Certificate type

- **EV certificate** — no SmartScreen reputation warm-up; recommended.
- **OV certificate** — works, but new installers show a SmartScreen warning until
  enough downloads build reputation.

## Alternative: Azure Trusted Signing

To sign via Azure instead of a `.pfx` (no certificate file to manage, instant
SmartScreen reputation), replace the `CSC_*` env vars in `release.yml` with the
Azure credentials and add an `azureSignOptions` block to `electron-builder.yml`:

```yaml
win:
  azureSignOptions:
    publisherName: '<your publisher name>'
    endpoint: 'https://<region>.codesigning.azure.net'
    codeSigningAccountName: '<account>'
    certificateProfileName: '<profile>'
```

and provide `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` as
workflow env from secrets.

## Auto-update behaviour

- Implemented in `src/main/autoUpdate.ts`, initialised from `src/main/index.ts`.
- **No-op in dev** (unpackaged) and when `SQLSENTINEL_DISABLE_UPDATE=1`.
- Feed + signature verification come from `app-update.yml`, baked in at package
  time from the `publish:` block in `electron-builder.yml`.
- `dev-app-update.yml` only matters if you force an update check in dev.

## Platforms

Only **Windows** is signed and distributed with auto-update today. The mac/linux
targets in `electron-builder.yml` still build but are unsigned and not published.
