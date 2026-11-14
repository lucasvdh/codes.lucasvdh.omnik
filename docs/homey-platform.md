# How the Homey platform works

Background an agent needs to make correct decisions in a Homey app. Researched in November 2026 from the official docs, the SDK reference, Athom's GitHub actions and the community forum. Items marked **[unverified]** come from forum reports, not official docs.

Primary sources (every page is also available as Markdown by appending `.md`):

- Docs: https://apps.developer.homey.app (index for LLMs: https://apps.developer.homey.app/llms.txt)
- SDK v3 reference: https://apps-sdk-v3.developer.homey.app
- Developer Tools (builds, crashes, stats, review status): https://tools.developer.homey.app
- SDK issue tracker: https://github.com/athombv/homey-apps-sdk-issues
- Community forum: https://community.homey.app (Developers category for questions)

---

## 1. Platforms

| Hardware | `homey.platform` / `platformVersion` |
| --- | --- |
| Homey Cloud (with Homey Bridge) | `cloud` / 1 |
| Homey (2016/2018/2019), Homey Pro (Early 2019) | `local` / 1 |
| Homey Pro (Early 2023), Homey Pro mini (2025), Homey Pro (2026), Homey Self-Hosted Server | `local` / 2 |

- If either value is undefined (old firmware), assume `local` / 1.
- `this.homey.hasFeature("speaker" | "ledring" | "nfc" | "camera-streaming" | "matter")` (Homey 12.7.1 and later) checks for hardware features.
- The manifest's `platforms` is `["local"]` or `["local", "cloud"]`. Publishing for Cloud requires a paid Verified Developer subscription, which only registered organisations can get. Community apps are effectively Pro-only.
- Athom was acquired by LG in July 2024. **[unverified]** Developers report that App Store apps also show up on LG ThinQ, and that crash reports from those installs may be missing.

## 2. Runtime

- **Node.js 22 on every platform since Homey 12.9.0.** Before that: Pro 2016–2019 ran Node 12, then 16; Pro 2023 and mini ran Node 18. If your `compatibility` allows older firmware, your code may run on Node 18 or lower.
- Homey Cloud apps only switch to Node 22 when a new version is published after 2025-12-02.
- Node 22 gotchas: `node-fetch` can fail with ECONNRESET (use the built-in `fetch`); a Node HTTP server answers 400 without a `Host` header; `homey-api` needs version 3.14.17 or later.
- A Python runtime exists too (`"runtime": "python"`). This template covers Node/TypeScript only.
- **Native addons are discouraged**: they must be compiled for every platform and break on Node upgrades.
- **Sandbox:** on Pro the app is chroot'ed (`/` is the app folder); on Cloud it runs in Docker. Always build paths from `__dirname`. `/proc` isn't mounted, so `process.memoryUsage.rss()` throws.
- **Resource limits:** the SDK emits `memwarn` and `cpuwarn` (`{ count, limit }`) on `this.homey`, and kills apps that keep exceeding them. **[unverified]** On Pro 2023 the memory warning reportedly starts around 150 MB, and the app is killed after ~50 s above it. Keep caches bounded.
- **Unhandled promise rejections crash the app on Homey Cloud**, and Athom has said this is coming to Pro. Treat it as a crash everywhere.
- **Multi-tenancy on Cloud:** several app instances share one Node process. No mutable module-level state, and clean up in `onUninit`. `this.homey.setTimeout` / `setInterval` are disposed of with the instance.

## 3. Not available on Homey Cloud

- The App Web API (`api.ts`). Webhooks still work.
- App-to-app communication (`homey:app:*`).
- The `homey:manager:api` permission.
- LAN discovery (mDNS-SD, SSDP, MAC). Homey Bridge doesn't support it.
- Custom app settings pages.

A Cloud-capable app does its configuration through pairing, repair and device settings.

## 4. App anatomy

- `.homeycompose/` is the source of the manifest. `app.json` is generated from it plus `drivers/*/driver.*.compose.json`. **Never edit `app.json` by hand.**
- Compose supports `capabilities/`, `flow/{triggers,conditions,actions}/`, `discovery/`, `drivers/templates/` (used through `"$extends"`), `drivers/settings/`, `signals/`, `screensavers/`, plus the `{{driverAssetsPath}}` placeholder.
- TypeScript: the CLI compiles with `tsc` into `.homeybuild/` and runs from there. `outDir` must be `.homeybuild/`. ESM (`.mts`) is supported but not used in this family.
- `env.json`: uppercase keys, string values, available as `Homey.env.KEY`. Gitignored. Per the docs, its values alone must not grant access to private resources.
- `README.txt` (+ `README.<lang>.txt`) is the store's long description. `.homeychangelog.json` holds the per-version changelog shown in the app and store.

### Manifest essentials

| Field | Rule |
| --- | --- |
| `id` | Reverse domain (`codes.lucasvdh.<name>`). **Permanent:** a new id is a new app, and users must rebuild their Flows. Don't include `homey`. |
| `version` | Semver. No pre-release suffixes. |
| `compatibility` | At least `>=5.0.0`. Raise it to use newer features (widgets ≥ 12.3.0, Node 22 everywhere ≥ 12.9.0, capability `uiState` ≥ 13.5.0). |
| `sdk` | `3` |
| `platforms` | `["local"]` unless you are a verified developer targeting Cloud. |
| `brandColor` | Required. The validator rejects colours that are too bright, because icons are rendered white on top. |
| `category` | One of `lights`, `video`, `music`, `appliances`, `security`, `climate`, `tools`, `internet`, `localization`, `energy`. |
| `author`, `contributors.developers/translators` | Credit people here, not in the readme. |
| `contributing.donate` | PayPal, GitHub Sponsors, etc. Shown for non-verified developers only. |
| `bugs.url`, `source`, `homepage`, `support` | URLs belong here, never in `README.txt`. `support` is mandatory for verified developers. |
| `homeyCommunityTopicId` | Links the store page to the app's forum topic. |
| `permissions` | Usually `[]`. Apps with new permissions **don't auto-update** on users' Homeys. |

## 5. Devices

- `data`: immutable identity for the device's lifetime (a MAC is fine, an IP is not).
- `store`: app-managed state. The docs call it "pretty rare" and prefer settings or discovery for addresses. In practice it's the right place for credentials and probe results.
- `settings`: user-editable. `setSettings()` does not fire `onSettings()`.
- `setUnavailable()` blocks all capabilities and Flow actions until `setAvailable()`.
- Energy: configure the driver's `energy` object (https://apps.developer.homey.app/the-basics/devices/energy).
- Capability options include `preventInsights` and `preventTag`.

## 6. Breaking changes

From the docs: "Publishing breaking changes is in general not allowed."

- New capabilities don't reach paired devices automatically. Add them in `onInit` behind a `hasCapability` guard.
- To retire a capability, remove it from the manifest and keep its listener. `removeCapability()` deletes its Flow cards and breaks Flows.
- Device class changes go through `setClass()` behind a guard.
- Retire Flow cards and drivers with `"deprecated": true`.
- Making an existing capability `getable: false` breaks Flows.

## 7. CLI

| Command | What it does |
| --- | --- |
| `homey login` / `homey select` | Authenticate, pick a Homey |
| `homey app run [--remote] [--clean]` | Run in development mode with live logs (Docker for Pro 2023+, remote for older). Ctrl+C uninstalls. |
| `homey app install` | Install without streaming logs |
| `homey app build` | Generate `app.json`, compile, package into `.homeybuild/` |
| `homey app validate --level debug\|publish\|verified` | Validate. `publish` is the default. `verified` adds `platforms`, `connectivity` and `support`. Needs Docker for Pro 2023+ targets. |
| `homey app version patch\|minor\|major\|x.y.z --changelog.en "…" [--commit]` | Bump version files and changelog. `--commit` commits and tags. |
| `homey app publish` | Upload a Draft build to Developer Tools |
| `homey app review [--type new\|update] [--model provider/model] [--json]` | AI review against the store guidelines (CLI 4.6.x and later). Runs publish-level validation first, then sends source files and images to OpenAI or Anthropic with your own key. Athom's official review uses `openai/gpt-5.4` (the default). Reads `.homeyreview.md`. Exits 1 only on `reject`. Doesn't check overlap with existing store apps. |
| `homey app translate` | Machine translation via OpenAI. Review the output. |
| `homey app add-types` | Install SDK type declarations |
| `homey app add-github-workflows` | Scaffold Athom's workflows (we use our own, see `.github/`) |
| `homey app manage` | Open the app in Developer Tools |

CI only validates and needs no token. Publishing happens locally with `homey login` (see `docs/release-process.md`).

## 8. Crash reports and diagnostics

- **Crashes** (uncaught exceptions, unhandled rejections) are reported automatically and listed **per build** in Developer Tools. Homey groups them by exact stack, so an error that contains a device id is split into one group per device.
- **Diagnostic reports** are sent by users: Homey app → More → Apps → <app> → ⚙ → *Send diagnostic report*, with an optional message. They show up in Developer Tools next to crashes. The text starts with `Note: this log has been manually submitted by a user.`, followed by `Log ID`, `User Message`, `stdout` and `stderr`. The logs hold the app's recent output, so log useful context.
- **[unverified]** Homey Cloud apps have no user-triggered diagnostic report.
- The Homey Developer MCP reads both through Athom's apps API, regroups crashes per actual bug, and parses reports. See `docs/agent-tooling.md`.

## 9. Support channels for developers

- The community forum's **Developers** category, the SDK issue tracker (https://github.com/athombv/homey-apps-sdk-issues), Stack Overflow tag `homey`.
- Athom's general support doesn't answer developer questions. Verified developers get code-level support.
- Free hand-drawn driver icons: https://github.com/athombv/homey-vectors-public/issues.
