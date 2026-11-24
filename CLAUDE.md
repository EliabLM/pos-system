# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Multi-tenant POS system being migrated (strangler-fig, incremental) from a Next.js monolith into 3 projects. This root is the git repo; `pos-system-client/` has no nested `.git`.

- `pos-system-client/` — Next.js 15 App Router + Prisma/PostgreSQL + custom JWT auth. **The only project with business logic today.** Has its own `CLAUDE.md` (full pattern catalog) and `AGENTS.md` (short list of what agents get wrong) — read those before working there.
- `pos-system-server/` — Express 5 + TypeScript, Clean Architecture scaffold (`src/app.ts`, `server.ts`, `config/env.ts`, `shared/`, `health/`). No domain modules yet (Fase 2+).
- `pos-system-app/` — Expo SDK 57 + expo-router scaffold. No business features yet (Fase 4). Has its own `AGENTS.md`.
- `packages/` — `dto-types`, `api-client`, `design-tokens` (empty scaffolds).

**Start every session by reading `docs/STATUS.md`** — the single source of truth for project state, migration phase, known tech debt, and the next step. When finished work changes project state, update `docs/STATUS.md` in the same commit.

## Workspace layout quirk

`pnpm-workspace.yaml` covers `pos-system-server`, `pos-system-app`, `packages/*` — but **NOT `pos-system-client`**, which stays self-managed with its own `pnpm-lock.yaml` until Fase 5 of the migration. Run client commands from inside `pos-system-client/`; run workspace-member commands from inside each member (not from the root).

## Commands

Package manager is **pnpm** everywhere (client pins 10.7.1). Do not use npm/yarn.

### pos-system-client (Next.js)
```bash
pnpm dev            # dev server (Turbopack)
pnpm lint           # ESLint
pnpm build          # prisma generate (against the server's schema) && next build — this is also the typecheck
pnpm db:generate    # regenerate the Prisma client only
pnpm db:seed        # idempotent Prisma seed (tsx prisma/seed.ts)
```
Client unit/contract tests use `node --test` (`pnpm test`, plus `pnpm test:images`); CI runs them in their own step. Verification = `pnpm lint` + `pnpm test` + `pnpm build`.

### pos-system-client E2E (Playwright)
Runs against the local docker stack (does not start a webServer itself):
```bash
# from repo root: cp .env.example .env, then
docker compose up --build          # db :5432, server :3001, client :3000
# from pos-system-client/
pnpm test:e2e                      # full suite (globalSetup waits for stack + reseeds)
pnpm test:e2e -- e2e/auth.spec.ts  # single spec file
pnpm test:e2e:ui / :debug / :report
# E2E_SKIP_SEED=1 skips the reseed when iterating; E2E_BASE_URL overrides :3000
```
See `docs/features/testing/RUNBOOK.md` for troubleshooting and seeded credentials.

### pos-system-server (Express)
```bash
pnpm dev            # tsx watch src/server.ts
pnpm test           # vitest run (single test: pnpm test -- src/path/file.test.ts)
pnpm test:watch
pnpm typecheck      # tsc --noEmit
pnpm lint / pnpm build / pnpm start
pnpm db:migrate -- --name <change>   # prisma migrate dev — the SERVER owns prisma/schema.prisma since Fase 1
pnpm db:deploy      # prisma migrate deploy
```

### pos-system-app (Expo)
```bash
pnpm start          # expo start (also: android / ios / web)
pnpm lint           # expo lint
```

### Local full stack
`docker compose up --build` from the root starts Postgres 17 + server + client. The **server** applies Prisma migrations on start (schema owner since Fase 1); the client waits for the server's healthcheck. The client image builds with the repo root as docker context (it needs `pos-system-server/prisma/`). The Expo web app is behind the `app` profile: `docker compose up db server client` omits it.

## Hard rules (enforced in review, apply to all projects)

1. **Strict TypeScript, zero tolerance**: never `any`, `@ts-ignore`, `@ts-expect-error`, or eslint-disable of type rules. Use `unknown` + narrowing or double assertion (`as unknown as T`).
2. **Never invent Prisma fields.** Before touching any model, read `pos-system-server/prisma/schema.prisma` (the server owns the schema since Fase 1; the client only consumes the generated client at `pos-system-client/src/generated/prisma`) and use only fields that exist. If a field is missing, ask the user to add it to the schema — do not add it in code.
3. **UI copy, toasts, and docs are in Spanish; code, identifiers, and comments in English.**
4. Client icons come from `@tabler/icons-react`, not `lucide-react`.

## Client architecture (details in `pos-system-client/CLAUDE.md`)

- Server actions per entity in `src/actions/<entity>/` returning `ActionResponse<T>` (`{ status, message, data }`); identity/tenant come ONLY from `requireActor()`/`getActor()` in `src/lib/auth/actor.ts` (never from parameters); shared Prisma singleton in `src/lib/db.ts` (re-exported by `src/actions/utils.ts`) — never `new PrismaClient()`. A guard test fails if an exported `'use server'` function skips the actor (modules pending migration are listed in `test/actions-guard.test.mjs`).
- Prisma client generates to a custom path: import from `@/generated/prisma`, never `@prisma/client`. The generated client is **committed to git** — expect diff churn after `prisma generate`; don't delete it.
- Custom JWT auth (migrated off Clerk): `src/middleware.ts` verifies the `auth-token` cookie with `jose` for UI redirects only (no `x-user-*` headers; server code uses `getActor()`). RBAC roles: ADMIN, SELLER — stored on `memberships` (users are global identities since Fase 1 paso 3; auth actions compose the user+membership view).
- Multi-tenant + soft delete: almost every query filters `organizationId` and `isDeleted: false`; deletes are `update({ isDeleted: true, deletedAt: new Date() })`.
- Client data flow: TanStack Query hooks in `src/hooks/use<Entity>.ts` wrap the server actions; Zustand store persists to sessionStorage.
- Feature pages follow `page.tsx` + `features/` subfolder — mirror an existing module (e.g. `src/app/dashboard/categories/`).

## Docs and conventions

- All documentation lives in `docs/` (in Spanish). New docs go in the matching category folder (`auth/`, `deployment/`, `features/<name>/`, `maintenance/`, `planning/`) and must be added to the `docs/README.md` index in the same commit.
- Auth target schema (source of truth for Fase 1/2 auth work): `docs/auth/AUTH_TARGET_SCHEMA.md`. Migration plan: `docs/planning/migracion-3-proyectos.md`.
- Project-specific skills live in `.opencode/skills/` (source of truth, shared with opencode): `postgresql-table-design` (tenant/soft-delete/migration targets), `node-clean-architecture` (server spine), `node-best-practices`, `react-best-practices`, `react-native-expo`, `frontend-design`, `interface-design`, `conventional-commits`. Each has a thin wrapper in `.claude/skills/` so Claude Code can invoke them — edit the `.opencode` originals, not the wrappers.
- Playwright test tooling: the `playwright-test` MCP server is configured in `.mcp.json`, and three subagents in `.claude/agents/` use it — `playwright-test-planner` (explore the app, save a plan to `specs/`), `playwright-test-generator` (generate a spec from a plan by executing steps live), `playwright-test-healer` (run/debug/fix failing tests). Prefer these subagents over calling the `mcp__playwright-test__*` tools directly. The docker stack must be up first.
- **Commits use Conventional Commits** (`feat(scope): …`) with scopes per project — see `.opencode/skills/conventional-commits/`. Git-flow style branches: `main` (prod), `release`, `develop`, `hotfix`; daily work branches off `develop`.
- Keep `AGENTS.md` (root and per-project) current when structure or conventions change.

## Agent skills

### Issue tracker

GitHub Issues de EliabLM/pos-system (con `gh`), siguiendo las etiquetas del equipo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` en la raíz + `docs/adr/`. See `docs/agents/domain.md`.
