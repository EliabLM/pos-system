---
name: node-best-practices
description: Operational craft for the `pos-system-server` Node.js + Express API — error handling, security, testing, production hardening, config, and style. Synthesized from goldbergyoni/nodebestpractices (Spanish) and adapted to this stack. Trigger: writing server code, hardening endpoints, reviewing operational quality, or making Node backend decisions.
---

# Node Best Practices (pos-system-server)

Operational craft for a Node.js + Express + TypeScript API. The architectural rules (layers, ports, dependency direction) live in `node-clean-architecture`; this skill is *how you write and operate* the code that lives in those layers.

Source: goldbergyoni `nodebestpractices` (Spanish translation) — 102 items, last updated 2021 / Node 14. The original is Express-native, so this mirrors it directly; where Node 14 specifics are obsolete, they're modernized.

## Stack alignment

- **Express + TypeScript** — goldberg is Express-native; keeping Express keeps the code readable for the project's maintainer. Plugin ecosystem: `express-rate-limit`, `helmet`, `express-validator`/Zod, `pino-http`, `compression`, `cookie-parser`.
- **Strict TS** — no `any`/`@ts-ignore` (project policy); use `unknown` + narrowing.
- **pnpm** — `pnpm install --frozen-lockfile` in CI (goldberg 5.19's `npm ci`, ported). Lockfile committed.
- **Node.js 22 LTS** minimum (goldberg 5.17).
- **Pino** logging via `pino-http` (goldberg 2.7's mature logger); never `console.log` in app code.
- Reuse what the existing client already does when porting a concern: `bcrypt` for hashing, custom JWT with `jose`/`jsonwebtoken`. Don't introduce a second auth library.

## 1. Structure (goldberg §1)

- **Components over layers-by-tech** (1.1): `src/modules/<feature>/` owns its whole vertical. Do not maintain a giant cross-feature `src/controllers/`.
- **Layers inside each component** (1.2): web → use-case → persistence; never pass Express `req`/`res` into use-cases (framework leak). Use-cases must be reachable from tests, CRON, queues.
- **Server ≠ app** (1.4): `app.ts` builds/configures the Express `app` (importable by tests via `supertest(app)`); `server.ts` boots it on a port. Tests import `app`, never `server`.
- **Shared utils as local packages or `src/shared/`** (1.3): logger, crypto/id helpers live in `shared/` (or a workspace package once multiple projects need them).

## 2. Errors (goldberg §2)

- **Async/await or promises** (2.1). Never throw in a callback; never float unawaited promises.
- **Native `Error` only** (2.2): custom errors subclass `Error`, carry a stable code + metadata. The Clean-Architecture `DomainError` hierarchy enforces this.
- **Operational vs programmer errors** (2.3): an operational error (bad input, gateway timeout, not-found) is handled and the process continues; a programmer error (assertion, undefined.where, bad invariant) — fail loud, restart the worker. Never `catch` a programmer error to silence it.
- **Centralized handler** (2.4): an Express error-handling middleware (`app.use((err, req, res, next) => …)`) — registered last — turns every thrown error into the HTTP response in one place. No ad-hoc `try/catch` returning responses in controllers. goldberg 2.4 explicitly: not inside per-handler code.
- **Map by type**, not by code-string matching. Map the `DomainError` subclasses from `node-clean-architecture` → status + stable error code; one correlation id per response.
- **RejectUnhandledPromiseRejections** (2.10): run with `--unhandled-rejections=strict` (or set the option) so an unhandled rejection crashes the worker, which the supervisor restarts. Combined with 2.6.
- **Always resolve/await before returning** (2.12): `return somePromise` without awaiting leaks partial stack on rejection. Be explicit.
- **Fail fast** (2.11): validate input with a schema at the boundary (Zod or `express-validator`). Never reach a use-case with unvalidated input.
- **Graceful shutdown** (2.6): on `SIGTERM`/`SIGINT` — stop accepting new connections, finish in-flight, close DB pool, exit. `http.Server.close()` (with `http-shutdown`-style helper) drains connections; wrap it.
- **Structured logging** (2.7/5.18): Pino JSON logs only; no `console.log` in app code; logs to stdout, never to files (a log router / Docker handles files). Never route logs to files inside the app process (goldberg 5.18).
- **Transaction id per request** (goldberg 5.14): a request-id on every log line. `pino-http` provides one (or generate a `cuid`/`uuid` per request via a small middleware); propagate to downstream calls and DB logs via context.

## 3. Code Style (goldberg §3 — project adds strict-TS)

- **ESLint** (3.1) with the security plugin (goldberg 6.1) and `@typescript-eslint` strict. No `eslint-disable` of type rules (project policy).
- `const` > `let` > never `var` (3.7). Use `===` (3.10). Arrow fns where appropriate (3.12). `async/await`, avoid callbacks (3.11).
- Named functions (3.5); clear naming (3.6). Import at top (3.8); import by folder, not deep files, where it aids refactors (3.9). Same-line braces (3.3).
- Type-driven: parse inputs into typed DTOs at the boundary; never pass `unknown`/`any` into use-cases.

## 4. Testing (goldberg §4)

- **At least API/component tests** (4.1) using `supertest(app)` against the same Express instance — no real port, no real HTTP client overhead; the app boots in-process. goldberg 4.13 (test middleware separately) is trivial here because routes are thin.
- **Test names in 3 parts** (4.2): `describe( system under test ) → it('condition → expected')`. **AAA** structure (4.3).
- **No global mutable fixtures** (4.5); per-test data, the in-memory repository or a clean test DB.
- **Coverage** (4.8): threshold on the **use-case ring** of `node-clean-architecture` (the cheap, fast, business-rules tests); don't chase 100% on adapters/E2E.
- **Tag/label tests** by ring (`@unit`, `@integration`, `@e2e`) so CI runs the fast ring every save and slow rings on push (4.7).
- **CI/quality** (4.5): `pnpm audit` for vulnerable deps (4.6/6.7) and a notifier for outdated (4.9). Use the LTS Node in CI and prod (5.17).
- **e2e on prod-like env** (4.10): same Node, same DB engine, same env var keys — only values differ.

## 5. Production (goldberg §5)

- **Monitor + APM** (5.1/5.8): app exposes metrics (Prometheus `/metrics` or an APM SDK); plan it from day one, not after the first outage.
- **Reverse proxy for gzip/SSL** (5.3): terminate TLS at Nginx/Cloudflare (the client already does this) — Node does TLS poorly under load.
- **Process availability** (5.5/5.6/5.12): run behind a process manager — Cluster/PM2/Docker restart=always. Be anti-state: one worker restart can't poison others; tolerate restarts mid-day.
- **Use all cores** (5.6): Node is single-threaded — cluster, PM2 cluster mode, or horizontal container scaling. Per cluster worker keep `--unhandled-rejections=strict`.
- **Maintenance endpoint** (5.7): a `/health` (liveness) + `/ready` (readiness, checks DB pool). Keep them cheap; load balancer hits `/ready` constantly.
- **Memory** (5.10): watch for leaks (event listeners, growing caches). Monitor via APM/metrics and refuse requests (503) under memory/event-loop pressure; lean on the process manager.
- **Measure + alert on memory/Eloop**; never serve frontend assets from Node (5.11) — the client project owns the web UI; the server is API-only.
- **Atomic, zero-downtime deploy** (5.16): health-check-driven roll; the DB migration is the riskiest step — apply backward-compatible migrations (add, don't remove) across releases (see `postgresql-table-design` Safe Schema Evolution).
- **NODE_ENV=production** (5.15) set explicitly — gates Prisma/ORM optimizations, stack-less errors, faster code paths.
- **Auto vulnerability scan** (5.13): `pnpm audit --prod` in CI, fail on high/critical.

## 6. Security (goldberg §6)

- **Linter security rules** (6.1): `eslint-plugin-security` — warn on `eval`, dynamic require, regex DoS patterns.
- **Rate limiting** (6.2): `express-rate-limit` per route (auth/login stricter — 6.12 brute-force protection).
- **Secrets out of code** (6.3): env vars / vault; never check in. Use the validated config module (goldberg 1.5) with a schema that fails fast on missing required secrets.
- **ORM/Prisma against injection** (6.4): always use Prisma's parameterized queries; `$queryRaw`/`$executeRaw` only with tagged templates, never string-concatenated SQL.
- **Security headers** (6.6): `helmet` defaults; add CSP for any HTML (the API shouldn't serve HTML, but defense-in-depth).
- **bcrypt/scrypt for passwords** (6.8): the client already uses `bcrypt`; reuse it. Never MD5/SHA for passwords.
- **Escape output** (6.9): the API returns JSON — use `res.json(...)` (no manual string concat). For any HTML, escape.
- **JSON schema validation** (6.10) on every inbound payload — Zod or `express-validator` is the boundary gate; the use-case receives already-validated input.
- **JWT blacklist + short TTL** (6.11): logout invalidates server-side (the client already migrated to custom JWT — port the blacklist/token-rotation to the server; see `docs/auth/`).
- **Run as non-root** (6.13): Docker `USER node` — never run the API as root.
- Bonus for a POS (retail): protect against replay/duplicate-submits on payments with an idempotency key (a `request_id` persisted short-TTL).

## 7. Config (goldberg §1.5)

- Hierarchical: defaults (safe) ← env (per-deploy) ← secrets (vault). Env over file.
- **Validate on boot** with a strict schema (Zod or `convict`): missing required vars → process refuses to start (fail-fast). Unknown vs known handled explicitly. This is one error you want loud at startup, never silent in prod.
- Typed `Config` object injected where needed — no `process.env.FOO` scattered through use-cases.

## 8. Perf & Docker (skeleton, expand as needed)

- goldberg §7 (in progress) + §8 Docker: multi-stage build, `---production` deps only, non-root user, no source maps in image, healthcheck instruction, pinned Node base image (LTS), `init: true` for signal forwarding in Docker.

---

*Synthesized from the goldbergyoni/nodebestpractices Spanish translation (102 items, 2021) — adapted to Express + TypeScript + pnpm + Node 22 LTS for the POS server. Pair with `node-clean-architecture` for layer/structure rules and `postgresql-table-design` for schema/migration safety.*