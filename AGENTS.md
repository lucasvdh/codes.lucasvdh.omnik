# AGENTS.md

Rules for AI coding agents (Claude Code, Codex, Cursor, …) working in this repository.
The rules here are short on purpose; the reasoning and examples live in `docs/`.
Keep both in sync when a rule changes.

---

## About this app

- **App:** Omnik (`codes.lucasvdh.omnik`), Homey SDK v3, TypeScript, Node.js runtime.
- **What it does:** reads power, energy, voltage, frequency and temperature from Omnik solar inverters on the local network, with Flow cards for production start/stop and thresholds.
- **Platforms:** `local`. Connectivity: `lan`. One driver: `omnik-local`.
- **Minimum Homey version:** `>=12.9.0`. From 12.9.0 on every platform runs Node 22, which matches the `@tsconfig/node22` base and `engines`.
- **Supported languages:** `en, nl, de, fr, it, sv, no, es, da, pl`. Every user-facing string exists in all of them.
- **Community topic:** https://community.homey.app/t/94499 (`homeyCommunityTopicId` in the manifest).
- **Store pages:** https://homey.app/a/codes.lucasvdh.omnik (live), https://homey.app/a/codes.lucasvdh.omnik/test (test).
- **External API / protocol:** the WiFi module's binary protocol on TCP/8899 (`lib/omnik-tcp-client.ts`), with `/js/status.js` over HTTP/80 as fallback and for pairing (`lib/omnik-http-client.ts`). Background: `docs/en/protocols.md`.
- **Docs:** `docs/en/` and `docs/nl/` are the user-facing GitBook (homey-omnik.gitbook.io). The other files in `docs/` are contributor and agent docs.

App-specific traps (keep this list current):

- At night the inverter powers down for lack of DC voltage and takes the WiFi module with it. With the default `offline_behavior = keep_available` a failed poll means "off" (power 0, device stays available), not "unavailable". Don't change that default (`lib/production.ts`).
- `meter_power` is the lifetime total. Never write 0 or null over an existing value: Insights reads that as a regression and breaks monthly totals. Daily and lifetime totals are left untouched when a poll fails.
- Unset TCP sensors arrive as `0xFFFF` / `0xFFFFFFFF` / `-1`. The parser turns them into `NaN` and the device writes `null`. Never write the raw value (it shows up as 655.35 kWh).
- HTTP mode has no voltage, frequency or temperature. Those capabilities stay `null`, which is expected.
- `data.id` is the WiFi module S/N as a number and is the device identity. It must never change. The IP lives in settings.
- Availability only changes on transitions and never throws: `setUnavailable` on every poll caused `SQLITE_FULL` crashes (#4, #6).
- In `onSettings` the new values aren't persisted yet; `buildApi(newSettings)` takes them as overrides.
- Discovery is Homey's MAC strategy (`omnik-wifi-module`), deliberately not linked to the driver so Homey doesn't manage availability (night shutdown). Pairing and polling must keep working when it finds nothing. Not yet verified on a real Homey.
- Firmware differs per module: `/js/status.js` may expose `webData` or only `myDeviceArray[0]` (#1), and an empty `myDeviceArray` / `yz_device_num="0"` means the inverter is asleep, not unsupported.
- The diagnostic report itself (the markdown users paste into GitHub) is English on purpose: it is read by the maintainer. Everything around it (settings page, progress, errors) uses locale keys under `settings.*`.

---

## Golden rules

1. **Never hand-edit `app.json`.** It is generated from `.homeycompose/**` and `drivers/*/driver.*.compose.json`, and is gitignored. Edit the compose files; `npm run homey-build` (or any `npm run homey-*` script) regenerates it. Use the npm scripts: bare `homey app ...` commands fail on a fresh clone because no `app.json` exists yet.
2. **Every bug fix and every crash fix starts with a failing regression test.** No exceptions for "small" fixes. See [Bugs and crashes](#bugs-and-crashes).
3. **No breaking changes for users.** Existing devices, Flow cards, capability ids, driver ids, setting keys and the app id are a contract. Migrate, don't rename. See `docs/architecture-conventions.md#migrations`.
4. **No unhandled promise rejections.** Every promise is awaited, returned, or ends in `.catch(this.error)`. On Homey Cloud an unhandled rejection crashes the app, and Pro is following.
5. **Homey timers only.** Use `this.homey.setTimeout` / `setInterval` in Homey classes and clear them in teardown. Plain `setTimeout` is only allowed in Homey-free `lib/` code, and that code must clear it.
6. **No user-facing string without a translation.** Every string goes through `this.homey.__()` / `Homey.__()` / compose `{ "en": ..., "nl": ... }` in every supported language. The App Store rejects partial translations.
7. **Never publish, release, submit for certification or post publicly without an explicit instruction for that specific action.** That covers the Homey Developer MCP write tools, `homey app publish`, and Discourse or GitHub posts. See `docs/agent-tooling.md`.
8. **Never put user data in public places.** Diagnostic reports contain user messages, device names, IP addresses and sometimes e-mail addresses. Refer to them by Log ID only in issues, commits, tests, fixtures and forum posts.

---

## Where things live

| What | Where |
| --- | --- |
| Manifest source | `.homeycompose/app.json` |
| Custom capabilities | `.homeycompose/capabilities/<id>.json` |
| App-wide Flow cards | `.homeycompose/flow/{triggers,conditions,actions}/<id>.json` |
| Driver-bound Flow cards | `drivers/<driver>/driver.flow.compose.json` |
| Discovery strategies | `.homeycompose/discovery/<id>.json` |
| Driver manifest / settings | `drivers/<driver>/driver.compose.json`, `driver.settings.compose.json` |
| Driver and device classes | `drivers/<driver>/driver.ts`, `device.ts` (thin) |
| Pair / repair views | `drivers/<driver>/pair/*.html`, `repair/*.html` |
| Homey-free logic (clients, parsing, decisions) | `lib/` (kebab-case file names) |
| Shared Driver/Device base classes | `lib/` (`lib/base-device.ts`, …) |
| Web API for settings page / widgets | `api.ts` (thin, delegates to the app) |
| Settings page | `settings/index.html` |
| Widgets | `widgets/<id>/` |
| Translations | `locales/<lang>.json` |
| Store text | `README.txt`, `README.<lang>.txt` (plain text, see store rules) |
| Changelog shown in the app | `.homeychangelog.json` |
| Secrets for the build | `env.json` (gitignored), documented in `env.example.json` |
| Tests | `tests/**/*.test.ts` |

Full layout and the reasoning: `docs/architecture-conventions.md`.

---

## Architecture rules (summary)

- **Thin Homey classes, fat `lib/`.** Driver, Device, App and `api.ts` wire Homey to logic. Protocol clients, parsers, state diffing, threshold decisions and error classification live in `lib/` without importing `homey`, so they can be unit tested.
- **One typed accessor for the App.** Access the App instance from drivers, devices, `api.ts` and widgets through `lib/app-accessor.ts` (`getApp(homey)`). No `this.homey.app as unknown as {...}` casts scattered around.
- **The App owns `homey.settings`.** App settings are read and written through typed accessors with key constants. Devices never call `this.homey.settings` directly.
- **Data, store, settings:** `data` = immutable identity (serial, MAC, cloud id; never an IP). `store` = values the app manages (credentials, resolved host, probe results). `settings` = what the user may edit. Store and settings keys are constants.
- **One teardown.** Every Device with timers, sockets or subscriptions has a single `teardown()` called from both `onUninit()` and `onDeleted()`.
- **Polling:** self-rescheduling `this.homey.setTimeout` with jitter and a generation counter, not a bare `setInterval`. Network calls always have a timeout. Retry with exponential backoff plus jitter, and honour `Retry-After`.
- **Availability:** `setUnavailable(this.homey.__(...))` when the device cannot work. `setWarning` when it still works partially or must stay controllable. Call `setAvailable` / `unsetWarning` only on state changes.
- **Triggers:** the first observation after (re)start only sets a baseline and never fires. Per-Flow thresholds go in the trigger's run listener with a `state` object. Use `getArgumentValues()` to skip expensive work no Flow uses.
- **Errors:** typed error classes in `lib/errors.ts`, mapped to localized messages at the Homey edge. Flow actions and capability listeners **throw** on failure so the user sees it. Never swallow an error and report success.
- **Long-running settings-page work** returns `{ runId }` at once and streams progress with `this.homey.api.realtime(...)`.

Details, examples and the exceptions: `docs/architecture-conventions.md`.

---

## Coding rules (summary)

- TypeScript `strict`. No `any` (including `homey: any` in `api.ts` and `session: any` in pairing); use the SDK types or a narrow local interface.
- Homey entry classes: `module.exports = MyDevice;`. Everything else uses named ES exports. No `"use strict";` in `.ts` files.
- File names: kebab-case in `lib/`. Driver ids and folders are `snake_case` or `kebab-case` without spaces; driver display names use spaces.
- Dependencies: prefer Node built-ins (`fetch`, `https`, `crypto`). No `node-fetch` (it breaks on Node 22). No native addons. Every new runtime dependency needs a reason in the PR.
- Logging: `this.log` for context that helps a diagnostic report, `this.error` for failures. Prefix log lines with a context tag (`[poller]`, `[pair]`). Never log secrets, tokens, PINs or full credentials.
- Code documents itself: names, types and small well-named functions instead of explanations. Add a comment only when it adds context the code cannot express and that would otherwise be missing (a device quirk, an issue number, a deliberate choice that looks wrong). Keep it as short as possible, one or two lines. No bug history in comments; that goes in the commit.
- No em-dashes (—) in user-facing text, changelogs or forum posts. Use a comma, a hyphen, or two sentences.

Details: `docs/coding-standards.md`.

---

## Commands

```bash
npm ci                 # install
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (type-aware; catches floating promises)
npm test               # compile tests to .test-build and run node --test
npm run check-locales  # every locale has the same keys as en.json
npm run homey-validate # homey app validate --level verified (strictest level; needs Docker)
npm run homey-review   # AI review against the App Store guidelines (needs an API key)
npm run homey-run      # run on a Homey (needs a Homey and `homey login`)
```

Before you say a change is done: `typecheck`, `lint`, `test` and `check-locales` pass. If you touched anything under `.homeycompose/`, `drivers/*/*.compose.json`, `locales/`, `assets/` or `README*.txt`, also run `homey-validate`.

Do **not** run `homey app run`, `homey app install` or `homey app publish` unless asked. They touch a real Homey or the App Store.

---

## Testing rules

- Framework: `node:test` + `node:assert/strict`, compiled through `tsconfig.test.json` into `.test-build/`. No Jest, no Mocha.
- Test the Homey-free code in `lib/` directly. Don't mock the Homey SDK broadly. If a class needs timers or a logger, inject a small interface (`TimerHost`, `log` callback).
- Fake external services at the transport boundary (a local HTTP server on port `0`, a fake socket). Never hit a real third-party API or a real device in CI.
- Required tests by change type:
  - **Bug fix or crash fix:** a regression test that fails without the fix, written first.
  - **New decision logic** (trigger conditions, parsing, state diffing, quirks): unit tests for every branch.
  - **New protocol / API call:** a test against a fake server with a recorded, sanitized response.
  - **Migration:** a test that the old shape becomes the new shape.
- Name regression tests after their source: `it("does not throw when a frame arrives after close (#42)")` or `(crash: TypeError in state-poller.ts:88)`.

Details: `docs/testing-conventions.md`.

---

## Bugs and crashes

When a bug is reported (GitHub issue, forum post, diagnostic report) or a crash shows up in the Homey Developer MCP:

1. **Gather.** With the `homey-developer` MCP: `get_crashes` for crash groups (error, file:line, count, affected builds), `list_diagnostic_reports` / `get_diagnostic_report` for user reports, `get_install_stats` for the scale. Read the forum topic with the Discourse MCP if the report came from there.
2. **Locate.** Map the stack frame to source (`.homeybuild/` is compiled output; the `.ts` file is the truth). Check whether the crash is still present on the latest build.
3. **Reproduce in a test.** Write the regression test, with sanitized data only, and watch it fail.
4. **Fix** the cause, not the symptom. If the root cause is a missing `.catch`, a leaked timer or an unguarded `getCapabilityValue`, look for the same pattern elsewhere and fix it there too.
5. **Verify:** the test passes, plus the commands above.
6. **Record:** commit as `fix(<area>): <user-visible outcome> (#issue)`. Add a user-facing line to `.homeychangelog.json` in every supported language when the release is cut.
7. **Report back** with a drafted reply (GitHub issue or forum). Post it only after the user approves the exact text. See `docs/community-and-support.md`.

---

## Releases

- Version bumps are separate commits: `chore: release vX.Y.Z`. They touch `.homeycompose/app.json`, `package.json`, `package-lock.json` and `.homeychangelog.json`, and are tagged `vX.Y.Z`.
- Semver, no pre-release suffixes (the App Store rejects them). Never lower a version.
- `.homeychangelog.json`: plain text, user-facing, every supported language, only what changed since the previous live version. No markdown, no URLs, no "fixed review feedback".
- Publishing uploads a Draft. Moving it to Test or Live, or submitting it for certification, is the maintainer's call.

Details: `docs/release-process.md`.

---

## Commits and pull requests

- Conventional Commits in English: `feat(scope): …`, `fix(scope): …`, `refactor:`, `test:`, `docs:`, `ci:`, `chore:`. The subject states the user-visible outcome. Reference issues as `(#123)`.
- The body explains *why*. For a fix: what the user saw, the cause, and how the fix addresses it.
- PR descriptions: what changed and why, in a few lines. Link the issue. Mention store-visible effects (new permission, new Flow card, changed images or texts).
- One topic per PR. Don't mix a feature with a release bump.

---

## Anti-patterns

- ❌ Editing `app.json` → edit compose files.
- ❌ `driver.ts` / `device.ts` with 1000+ lines mixing protocol, diffing and Flow wiring → extract to `lib/`.
- ❌ `.trigger(...)`, `setCapabilityValue(...)` or `setStoreValue(...)` without `await` or `.catch(this.error)`.
- ❌ `setInterval` / `setTimeout` from the global scope in a Device or Driver, or a timer that is not cleared in teardown.
- ❌ `onDeleted` that copies `onUninit` → both call `teardown()`.
- ❌ Catching an error in a Flow action or capability listener, logging it and returning normally → rethrow (localized) so the Flow shows the failure.
- ❌ `this.log(err.message)` for errors → `this.error("[ctx] what failed", err)`.
- ❌ `throw new Error("Please re-pair the device")` → `throw new Error(this.homey.__("error.repair_required"))`.
- ❌ Hard-coded English strings in `api.ts`, the settings page or widgets → locale keys.
- ❌ `removeCapability` for a capability users may have Flows on → remove it from the manifest, keep the listener (see migrations).
- ❌ Renaming a Flow card id, argument name, capability id, setting key or driver id → add a new one and deprecate the old one.
- ❌ IP addresses in `data` → `store` or settings, refreshed by discovery.
- ❌ Throwing errors as control flow ("no token configured") → return a typed result.
- ❌ Copying dead boilerplate between apps (a `remote.ts` nobody imports, unused `node-fetch`).
- ❌ Fixed localhost ports in tests → listen on port `0`.
- ❌ Real user data in fixtures → sanitize.
- ❌ Features, Flow cards, URLs, donation links or markdown in `README.txt` → the store rejects them.

---

## More detail

- `docs/architecture-conventions.md`: layout, lifecycle, pairing, Flow, polling, availability, migrations, settings/store/data, `api.ts`, widgets
- `docs/coding-standards.md`: TypeScript, style, errors, logging, HTTP, i18n, dependencies
- `docs/testing-conventions.md`: test setup, what to test, fakes, regression tests, CI
- `docs/homey-platform.md`: how Homey works (platforms, Node versions, sandbox, Compose, limits, Cloud vs Pro)
- `docs/app-store-guidelines.md`: official store rules plus the unwritten ones that cause rejections
- `docs/release-process.md`: versioning, changelog, channels, publishing
- `docs/agent-tooling.md`: Homey Developer MCP and Discourse MCP, what agents may and may not do
- `docs/community-and-support.md`: forum topic conventions, reply templates, issue triage
