---
name: node-clean-architecture
description: Design spine for the `pos-system-server` Node.js API — Clean Architecture + SOLID applied to an Express + TypeScript backend. Trigger: scaffolding the server project, adding a domain module/use-case, defining layers or boundaries, or any structural decision in the API codebase.
---

# Node Clean Architecture (pos-system-server)

The server is built on **Clean Architecture + SOLID**, not on a framework's opinions. Frameworks are replaceable outer adapters; the domain and use-cases know nothing about HTTP, Prisma, or Express. This skill is the structural rulebook for `pos-system-server`.

## Stack decisions (commit unless overridden)

- **Node.js 22 LTS** at minimum (goldberg 5.17 — never current branch in prod).
- **Express + TypeScript**, not NestJS. goldberg's layering advice is Express-native; keeping the framework simple keeps the code readable for the project's maintainer. NestJS imposes its own module/DI system that competes with a hand-built Clean Architecture.
- **Strict TS** — no `any`, `@ts-ignore`, or eslint-disable of type rules (carried from the client policy; use `unknown` + narrowing).
- **Prisma** stays behind a **repository adapter** — use-cases depend on a repository *port* (interface), never on `PrismaClient`. Prisma migrations/schema are governed by the `postgresql-table-design` skill.
- DI is light (a small composition root / factory), not a heavy DI container — keeps the dependency graph explicit.

## The dependency rule (everything points inward)

```
  framework/web ─→ interface adapters ─→ use-cases ─→ domain entities
  (Express)         (controllers,          (app      (pure TS, no deps)
                     repositories,          logic)
                     gateways)
  ────────────────────────────────────────────────────────────►
   outer = volatile (replaces Express, Prisma with ease)
   inner = stable  (business rules; survives any framework swap)
```

Nothing in an inner ring may import from an outer ring. Domain entities never import `express`, `@prisma/client`. Use-cases never import HTTP types (`Request`/`Response` from Express). If you see that import, the boundary is broken — fix it.

## Organize by feature, not by tech layer

A top-level `src/users/` owns its whole vertical; inside it the clean layers separate. Scales without a giant `src/controllers/` folder of unrelated files (goldberg 1.1).

```
pos-system-server/src/
├── shared/                      # cross-cutting kernel: errors, types, Result, logger
│   ├── domain/                  # ValueErrorResult, DomainError, Value Objects (Money, TenantId)
│   └── ...
├── modules/
│   ├── sales/
│   │   ├── domain/              # entities: Sale, SaleItem (pure TS, no framework imports)
│   │   ├── use-cases/           # ring 2: CreateSale, GetSalesById, DeleteSale
│   │   │   └── SaleRepository.ts # PORT — interface the use-case depends on
│   │   ├── adapters/
│   │   │   ├── http/            # ring 3: express route + controller (serializes)
│   │   │   ├── persistence/     # ring 3: PrismaSaleRepository implements SaleRepository
│   │   │   └── gateways/        # ring 3: PaymentGateway, maybe external
│   │   └── sales.module.ts      # composition: wires port→adapter, controller→use-case
│   ├── catalog/  ...             (products, categories, brands)
│   ├── auth/     ...
│   └── tenant/   ...
├── config/                      # validated env + config (see node-best-practices)
└── server.ts                    # the composition root: build the container, start Express
```

A use-case imports a **port** (repository interface) and the `shared/domain` primitives. The module's composition wires the **adapter** (Prisma repo) into the use-case. Swapping Prisma for a different persistence later touches one folder.

## Request flow (kept strictly layered)

1. Express route matches → **controller** method receives `req`/`res` (the route handler delegates, not the use-case).
2. Controller parses & validates input (Zod, `express-validator`, or Joi) into a **use-case input DTO** (plain primitives/VOs, no Express types).
3. Controller calls the **use-case** with that input + injected repository port.
4. Use-case enforces business rules, calls the port, returns a domain result (`Result<T, DomainError>` or a thrown domain error).
5. Controller maps the result → HTTP response, serializing only what should leave the API. On error, delegate to the central error handler (see `node-best-practices`) — never leak stack traces in prod.

**Hard rule:** a use-case signature may use only primitives, value objects, and port interfaces. Banning Express `req`/`res`/`Request`/`Response` from use-cases keeps them callable from CRON jobs, message queues, and **tests without spinning up the server** (goldberg 1.2).

## SOLID, concretely

- **S** — one use-case per file; one responsibility per layer (controller = HTTP, use-case = rule, repo = persistence).
- **O** — add a new payment gateway by implementing the `PaymentGateway` port; don't edit existing use-cases.
- **L** — any `SaleRepository` implementation (Prisma, in-memory test fake) is substitutable; use-cases behave identically. This is what enables the test ring.
- **I** — ports are small and focused (`SaleReader` vs `SaleWriter` if read/write split helps); don't force a use-case that only reads to depend on a write interface.
- **D** — use-cases depend on **abstractions** (port interfaces), not concretions (`PrismaClient`). The composition root decides which concrete adapter satisfies each port.

## Ports & adapters (the boundaries that matter)

- **Persistence:** `FooRepository` interface in the module's use-cases folder; `PrismaFooRepository` in adapters, importing Prisma + applying tenant filter / RLS session var.
- **HTTP:** Express route handlers + controllers in `adapters/http`. Routes are wiring, not logic.
- **Auth/tenant:** an `AuthContext` port extracts the authenticated principal from the request (middleware sets it from JWT — see client `src/middleware.ts` reference). Use-cases receive an `AuthContext` value, never a `request`.
- **3rd-party:** `PaymentGateway`, `UploadGateway`, `BarcodeLookupGateway` — interfaces with an adapter per provider. Swap providers by swapping an adapter.
- **Clock / id-gen:** abstract time (`Clock.now()`) and id generation so tests are deterministic. The `postgresql-table-design` skill mandates UUIDv7 — generate it via an injectable id-provider so tests can stub it.

## Tenant isolation in the persistence adapter

DB-level isolation is the target (see `postgresql-table-design` — RLS on `organization_id`). The persistence adapter is the place that, per request, sets the session var the framework doesn't manage: e.g. `prisma.$executeRaw\`SET LOCAL app.tenant_id = ${tenantId}\`` inside a transaction. Use-cases still pass the `TenantId` value object via ports; the adapter enforces RLS as defense-in-depth. Never leak tenant filtering into use-cases via framework code — but the use-case *does* carry the authenticated `TenantId` from `AuthContext` (it's a domain concept, not a web concept).

## Errors

- Define **domain errors** in `shared/domain` (`ValidationError`, `NotFound`, `Conflict`, `Unauthorized`, `Forbidden`, `Invariant`). Subclass a single `DomainError`.
- Use-cases either throw these domain errors OR return `Result<T, DomainError>`. Pick one convention per module and stay consistent.
- Controllers/central handler map `DomainError` subclasses → HTTP status + stable error code. Non-domain errors (`DatabaseError`, gateway timeouts) map to 5xx with a generic message + a correlation id.
- Never expose stack traces or internal message text in production responses. See `node-best-practices` for the centralized error handler + structured logging.

## Testing by ring

- **Use-cases (unit):** instantiate the use-case with an **in-memory repository** (satisfies the same port). No Express, no DB, no Prisma. This is the cheapest, fastest, most numerous test ring; the bulk of business-logic coverage lives here. goldberg 1.2 is the payoff — "the app can be reached by tests, CRON, queue consumers".
- **Adapters (integration):** `PrismaSaleRepository` against a real (test) Postgres — proves SQL/migrations/RLS behave. HTTP controllers tested with `supertest(app)` against the same Express instance (no port binding — goldberg 4.10/4.13).
- **E2E:** `supertest(app)` hitting routes end-to-end against a test DB — few, for critical flows (sale checkout, auth).
- Use `vitest` (or the project's chosen runner) + coverage thresholds on the use-case ring.

## Anti-patterns (review-blocking)

- Controller importing `PrismaClient` directly (skips the port).
- Use-case importing `express` or using `req`/`res`/`NextFunction` (framework leak inward).
- Repository returning Prisma model types (leaks the ORM into the domain) — always map to domain entities at the adapter boundary.
- Business rule written in the controller or the route (rule lives in use-cases).
- Domain entity importing `@prisma/client` for `@map`/decorators (entities are plain TS).
- Hard-coded tenant id or pulling it from a global; not from the `AuthContext` port.
- Service object that is just `PrismaClient.foo.bar` passthrough with no business meaning (anemic use-case / leaky abstraction).
- Throwing raw strings/`Error('not found')` instead of typed domain errors.

## When to break the rule

- For trivial CRUD over a stable resource (e.g. an audit-log write), a thin use-case that mostly delegates to the port is fine — don't over-engineer. Clean Architecture is about **boundaries**, not ceremony.
- If a query is pure read with no rule, a query-handler (read side) may call the repo port directly and return a DTO; you don't need a full use-case + domain entity for every list endpoint (CQRS-lite).

## Pointers

- `postgresql-table-design` — schema, RLS, UUIDv7, soft-delete uniqueness.
- `node-best-practices` — operational craft: error handling, security, logging, config, testing, prod hardening.

---

*Authored for the POS server migration; grounded in Clean/Hexagonal Architecture, SOLID, and goldberg's `nodebestpractices` (Spanish) layers/component advice — adapted to Express + TypeScript + Prisma.*