# Coding standards

Code-level rules for TypeScript Homey apps. For structure and lifecycle see `docs/architecture-conventions.md`.

---

## 1. TypeScript and build

- `tsconfig.json` extends the `@tsconfig/node*` base that matches the **lowest Node version the app can run on**:
  - `compatibility >= 12.9.0` → `@tsconfig/node22` (all platforms run Node 22 from Homey 12.9.0 on).
  - lower compatibility → `@tsconfig/node18` or lower. Don't use APIs your oldest supported Homey lacks.
- Required compiler options: `strict: true` (from the base), `outDir: ".homeybuild/"` (the Homey CLI expects it), `sourceMap: true`, `module: "commonjs"`, `esModuleInterop: true`, `resolveJsonModule: true`.
- `engines.node` in `package.json` matches the CI Node version (22).
- `@types/homey` is the npm alias for the community SDK v3 types: `"@types/homey": "npm:homey-apps-sdk-v3-types@^0.3.12"`. When the types lack something (for example `ManagerDashboards`), declare a narrow local interface in `lib/types/homey-ext.d.ts` rather than casting to `any` at the call site.
- The `homey` CLI is a devDependency, so CI and contributors use the same version (`npx homey ...`).
- Tests compile through `tsconfig.test.json` into `.test-build/`. That folder is gitignored and homeyignored.

### Types

- No `any`. Use SDK types (`import type PairSession from "homey/lib/PairSession"`, `import type Homey from "homey/lib/Homey"`) or a narrow interface.
- `unknown` for parsed external data, narrowed with a type guard or a small validator. Never trust a device or cloud response shape.
- Response types for external APIs live in `lib/types.ts` or next to the client. If the vendor publishes an OpenAPI spec, keep it in `api-specs/<api>-v<major>.<minor>.yaml` as reference.
- Prefer union types and `as const` objects over TypeScript `enum`.

### Modules

- Homey entry classes (`app.ts`, `driver.ts`, `device.ts`) end with `module.exports = ClassName;`. Homey loads them with `require`.
- Everything else uses named ES exports. No default exports in `lib/`.
- No `"use strict";` in `.ts` files. The compiler emits it.
- Import order: Node built-ins, packages, `homey`, then local modules. Use `import type` for type-only imports.

---

## 2. Style

- Formatting: Prettier defaults with double quotes, semicolons, trailing commas, 2-space indent and a print width of 100. Don't reformat files you aren't otherwise changing.
- Naming:
  - classes `PascalCase`; functions and variables `camelCase`; constants `UPPER_SNAKE_CASE`;
  - files in `lib/` `kebab-case.ts`;
  - locale keys `area.sub_key` (`device.error.unreachable`, `pair.no_devices`, `settings.progress_probing`);
  - Flow card ids `snake_case`, prefixed per driver when shared (`oven_program_finished`);
  - realtime event names `<app-short-name>:<area>:<event>` (`philips-tv:report:progress`).
- Keep functions small and named after what they decide. A well-named function beats a comment.
- Numbers with units get the unit in the name: `pollIntervalMs`, `timeoutSeconds`.

### Self-documenting code and comments

Code documents itself. Names, types and small functions say what the code does and why it is shaped that way; a reader should not need a comment to follow it.

- Before writing a comment, try to make it unnecessary: rename a variable, extract a function named after the decision (`shouldResetDaily`), introduce a constant with a unit (`RETRY_DELAY_MS`), or use a type instead of a convention.
- A comment is allowed only when it adds context the code cannot carry and that would otherwise be missing: a device or firmware quirk, the issue number behind a non-obvious choice, something this code must stay in step with, or a deliberate choice that looks like a mistake.
- Keep comments as short and to the point as possible: one line, two at most. A longer explanation belongs in `docs/development/<topic>.md`, with a link from the code.
- No comments that restate the code, no bug history ("this used to…", "previously caused…"; that goes in the commit message), no commented-out code, no TODOs without an issue number.
- When you change code, update or delete the comments next to it. A wrong comment is worse than none.

---

## 3. Async, promises and timers

These rules prevent most Homey app crashes.

- **Every promise is handled.** Await it, return it, or end it with `.catch(this.error)`. ESLint's `@typescript-eslint/no-floating-promises` and `no-misused-promises` enforce this.
- Fire-and-forget is explicit: `void this.refresh().catch((err) => this.error("[refresh]", err));`.
- Never pass an async function where a sync callback is expected (`emitter.on("data", async ...)`) without a try/catch inside. A rejection there is unhandled.
- Event handlers on sockets and emitters wrap their body in try/catch. An exception in an `on("message")` handler is an uncaught exception.
- **Timers in Homey classes:** `this.homey.setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`. Homey disposes of them when the app unloads. Every timer is cleared in `teardown()`.
- Timers in Homey-free `lib/` code go through an injected `TimerHost`, or use global timers that the code itself clears (`clearTimeout` in `finally`, or `.unref()` for races).
- `Promise.race` with a timeout must clear the timer when the other promise wins.
- Use `Promise.allSettled` when one failing part shouldn't throw away the others.
- Single-flight concurrent identical calls (a shared in-flight promise) for pairing requests, token refresh and cache fills.

```ts
export async function withTimeout<T>(p: Promise<T>, ms: number, timers: TimerHost): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => { t = timers.setTimeout(() => reject(new TimeoutError(ms)), ms); }),
    ]);
  } finally {
    timers.clearTimeout(t);
  }
}
```

---

## 4. Errors

### Typed errors in `lib/errors.ts`

```ts
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class OfflineError extends AppError {}
export class AuthError extends AppError {}
export class ProtocolError extends AppError {
  constructor(message: string, readonly statusCode?: number) { super(message); }
}
export class RateLimitError extends AppError {
  constructor(readonly retryAfterMs?: number) { super("rate limited"); }
}
```

- `lib/` throws typed errors with technical English messages, meant for logs.
- The Homey edge (device, driver, `api.ts`) maps them to localized user messages:

```ts
function userMessage(homey: Homey, err: unknown): string {
  if (err instanceof AuthError) return homey.__("error.auth_failed");
  if (err instanceof OfflineError) return homey.__("error.unreachable");
  return homey.__("error.unknown");
}
```

### Rules

- Flow actions, conditions and capability listeners **throw** on failure (`throw new Error(userMessage(this.homey, err))`). Logging and returning normally tells the user it worked.
- Unknown input (an unsupported mode, an unknown key) is an error, not a silent no-op.
- Keep the cause: `new ProtocolError("bad status", { cause: err })`, and log the cause.
- Don't use exceptions for expected states ("no token configured"). Return a typed result or check up front.
- Error messages never contain secrets, full response bodies with tokens, or user data.

---

## 5. Logging

- `this.log(...)` for useful context, `this.error(...)` for failures. Homey-free classes take a `log` callback.
- Tag lines with their context: `this.log("[pair] probing", host)`, `this.error("[poller] refresh failed", err)`.
- Diagnostic reports contain recent stdout and stderr. Log enough to reconstruct what happened (state transitions, chosen transport, firmware version, retry counts), not every successful poll.
- Verbose logging goes behind a flag (`Homey.env.DEBUG === "true"` or a hidden device setting).
- **Never log** passwords, tokens, API keys, PINs, OAuth codes, full digest headers, or e-mail addresses. Redact (`token: …${token.slice(-4)}`).
- Error logs pass the error object (`this.error("[x] failed", err)`) so the stack ends up in the report, not just `err.message`.

---

## 6. HTTP and network clients

- Prefer Node built-ins: global `fetch` (Node 18+), `https`, `net`, `tls`, `dgram`. Use `axios` only when you need what it adds. **Never `node-fetch`** (ECONNRESET problems on Node 22).
- **Every request has a timeout** (`AbortSignal.timeout(ms)` with fetch, or `timeout` + `req.destroy()` with `https`). A hanging request without a timeout stalls polling forever.
- Retry only idempotent requests, with exponential backoff and full jitter, capped. Honour `Retry-After` on 429 and 503. Don't retry 4xx except 408/429.
- Map status codes to typed errors in one place (`parseResponse`).
- Cache with TTLs and coalesce in-flight identical requests when several devices ask for the same data.
- Self-signed TLS (local devices): scope `rejectUnauthorized: false` to that device's agent only, never process-wide (`NODE_TLS_REJECT_UNAUTHORIZED`).
- Devices that can't handle concurrency get a per-device request queue (a promise-chain mutex).
- Clients are classes in `lib/` with injected config, logger and timers. They don't read Homey settings themselves.
- Token handling: cache access tokens until shortly before `exp`, refresh single-flight, clear on 401/403, persist only what you need to (the refresh token, in app settings or the device store).

---

## 7. Internationalization

- Every user-facing string exists in every supported language. That covers manifest name and description, capability titles, Flow card titles, args, hints and tokens, driver names, settings labels and hints, pair views, settings page, widgets, errors, `README.<lang>.txt` and `.homeychangelog.json`.
- Code strings: `this.homey.__("key", { tokens })`. HTML: `Homey.__("key")` or `data-i18n`. Compose: `{ "en": "...", "nl": "..." }`.
- `locales/en.json` is the source of truth. `npm run check-locales` fails when another locale misses or adds keys.
- Don't build sentences from fragments. Use tokens: `"Source __source__ is not supported"`.
- Locale-dependent formatting (numbers, dates, durations) goes through `Intl` with `this.homey.i18n.getLanguage()`.
- Timezone math: use `this.homey.clock.getTimezone()` or an explicit zone. Never `Date#getHours()` on the server, which runs in UTC or an unknown zone.
- Adding a language means translating everything, not only the description. Partial translations are rejected by the store.

---

## 8. Dependencies

- Few runtime dependencies. Every new one needs a reason: what it does that a built-in can't.
- No native addons (`.node` files). They must work on ARM and x64 and break on Node upgrades.
- Check the package size. Everything in `dependencies` ships to every Homey.
- Dependabot keeps npm and GitHub Actions current. Read the changelog of a major bump and run the full checks.
- Remove unused dependencies and dead files (copied boilerplate, old scripts) when you notice them.

---

## 9. Security

- Secrets the build needs (OAuth client id/secret) go in `env.json` (gitignored), documented with placeholder values in `env.example.json`. Per the Homey docs, an `env.json` value alone must not grant access to user data.
- User secrets (API keys, passwords, tokens) go in the device store or app settings, never in `data` (which shows up in more places) and never in logs.
- The settings page never receives a stored secret back in full.
- Validate and bound all input from `api.ts`, pair views and Flow args. Treat device and cloud responses as untrusted.
- Escape everything inserted into HTML in settings pages, pair views and widgets.
- CI: SHA-pinned actions, `permissions: contents: read`, `persist-credentials: false`, `npm ci --ignore-scripts`, and never `pull_request_target`.

---

## 10. Writing style for user-visible text

Applies to locales, changelogs, README texts, GitHub replies and forum posts.

- Short and concrete. Say what changed for the user, not how the code changed.
- No em-dashes (—). Use a comma, a hyphen or two sentences. (In forum posts they also read as AI-generated text.)
- No marketing language, no exclamation marks in errors.
- Errors say what happened and what to do: "Cannot reach the TV. Check that it is on and connected to the same network."
