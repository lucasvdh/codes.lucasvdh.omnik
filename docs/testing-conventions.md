# Testing conventions

Every app has tests and CI from the first commit. Every bug or crash fix adds a regression test.

---

## 1. Setup

No test framework dependency: `node:test` and `node:assert/strict` ship with Node.

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": ".test-build",
    "rootDir": ".",
    "sourceMap": true
  },
  "include": ["*.ts", "lib/**/*.ts", "drivers/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"]
}
```

`package.json` scripts:

```json
{
  "typecheck": "tsc --noEmit && tsc -p tsconfig.test.json --noEmit",
  "test": "tsc -p tsconfig.test.json && node --test --test-timeout=10000 --enable-source-maps \".test-build/tests/**/*.test.js\"",
  "test:coverage": "npm test -- --experimental-test-coverage"
}
```

- `--test-timeout` makes a test that never settles fail instead of hanging CI. A hanging test usually means a real bug (a promise that never resolves); keep it as the regression test.
- `scripts/**/*.ts` (developer probes) is in `tsconfig.test.json` so it is typechecked and linted; ESLint allows `console` there.
- Tests live in `tests/`, mirroring `lib/` (`tests/lib/state-poller.test.ts`), or flat for small apps.
- Only `*.test.ts` files run. Manual probes against real devices (`tests/manual/*.ts`) are fine for development but never run in CI and never contain real credentials or addresses.
- `.test-build/` is in `.gitignore` and `.homeyignore`, and so is `/tests`.

---

## 2. What to test

The architecture keeps logic out of Homey classes (`docs/architecture-conventions.md` §1), so most logic can be tested without the SDK.

| Change | Required test |
| --- | --- |
| **Bug fix** | Regression test that fails without the fix. Written first. |
| **Crash fix** (Developer MCP / Developer Tools) | Regression test reproducing the throwing input or sequence. Written first. |
| Decision logic (trigger conditions, thresholds, diffing, "is this a change") | Unit tests for every branch, including the first-observation baseline. |
| Parsing, codecs, quirks per firmware or model | Table-driven tests with sanitized real samples. |
| New API call or protocol message | Test against a fake server or socket with a recorded, sanitized response, including error statuses. |
| Retry, backoff, timeout behaviour | Test with fake timers (`node:test` `mock.timers`) or an injected `TimerHost`. |
| Migration | Old shape in, new shape out. |
| Pure refactor | Existing tests pass. If there are none, write characterization tests first. |

Not required: tests that only check Homey wiring (a listener was registered). Those are covered by `homey app validate` and running the app.

---

## 3. Regression tests

The rule: **no fix without a test that would have caught it.**

1. Reproduce the failure in a test using the inputs from the report (the stack trace, the sequence of events, the response the device sent). Sanitize: no real IPs, names, tokens or e-mail addresses.
2. Run it and see it fail for the reported reason.
3. Fix, and see it pass.
4. Name it after the user-visible behaviour plus the reference:

```ts
it("keeps the device available while the TV is in standby (#64)", ...);
it("does not throw when a frame arrives after close (crash: TypeError home-connect-client.ts:88, v1.4.0)", ...);
```

If the bug sits in Homey wiring that can't be tested directly (a listener in `device.ts`), move the logic into a Homey-free function in `lib/` and test that. That extraction is part of the fix.

If a regression test is really impossible (a firmware behaviour no fake can model), say so in the PR description and add the reproduction steps to `docs/development/`.

---

## 4. Fakes, not mocks

- **Don't mock the Homey SDK** broadly. A hand-written mock of `Homey.Device` drifts from the real one and tests the mock.
- **Inject seams** instead: a `TimerHost`, a `log` callback, a `fetch`-like function, a socket factory.
- **Fake at the transport boundary:**
  - HTTP: a real `http.createServer` on **port 0** (`server.listen(0)`, then read `server.address().port`). Never a fixed port: it collides on CI and on developer machines.
  - Sockets and websockets: an `EventEmitter`-based fake with the same surface.
  - Time: `mock.timers.enable({ apis: ["setTimeout", "Date"] })` from `node:test`, or a fake `TimerHost` you advance by hand.
- Fixtures live in `tests/fixtures/`, sanitized. Record real responses once, then strip identifiers.
- Never hit a real third-party API, cloud service or device in CI.

Example of a fake server helper:

```ts
// tests/helpers/fake-server.ts
import http from "node:http";
import type { AddressInfo } from "node:net";

export async function fakeServer(routes: Record<string, (req: http.IncomingMessage) => { status: number; body?: unknown }>) {
  const server = http.createServer((req, res) => {
    const route = routes[`${req.method} ${req.url}`];
    const { status, body } = route ? route(req) : { status: 404 };
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
```

---

## 5. Static checks that count as tests

- `npm run typecheck`: strict TypeScript for app and test code.
- `npm run lint`: ESLint with type information. At minimum `no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unused-vars`. These catch the unhandled rejections that crash Homey apps.
- `npm run check-locales`: every locale has exactly the keys of `en.json`.
- `homey app validate --level verified`: manifest, compose, images, translations of required fields.

---

## 6. CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

1. Install with `npm ci --ignore-scripts`.
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run check-locales`
6. `npx homey app validate --level verified`

Hardening, required for every workflow:

- `permissions: contents: read` at the top. Jobs that need more ask for it themselves.
- Actions pinned to a full commit SHA, with the version as a comment. Dependabot updates them.
- `persist-credentials: false` on checkout.
- `concurrency` with `cancel-in-progress` per ref.
- `timeout-minutes` on every job.
- Never `pull_request_target`: fork PRs must not get secrets or a write token.

A failing CI check is never fixed by skipping a test, loosening a lint rule, or adding `// @ts-ignore`. Fix the cause, or ask the maintainer.

---

## 7. Manual verification

Some changes can only be fully checked on a real Homey: pairing views, capability UI, Flow card rendering, discovery. Agents can't do that. When a change touches these, say so in the PR and list what the maintainer should check with `homey app run`.
