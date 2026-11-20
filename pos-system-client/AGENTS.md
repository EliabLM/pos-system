# AGENTS.md

Multi-tenant POS system: Next.js 15 (App Router) + Prisma/PostgreSQL + custom JWT auth.
Detailed conventions live in `CLAUDE.md` and `.claude/agent-rules.md` — read those for patterns. This file is the short version of what agents get wrong.

## Commands

Package manager is **pnpm 10.7.1** (pinned in `package.json`). Do not use npm/yarn.

```bash
pnpm dev            # dev server (Turbopack)
pnpm lint           # ESLint (flat config; src/generated is ignored)
pnpm build          # prisma generate (server schema) && next build — this is also the typecheck
pnpm db:generate    # regenerate the Prisma client only
```

- **The Prisma schema lives in `../pos-system-server/prisma/schema.prisma`** (the server owns it since Fase 1). Migrations run from `../pos-system-server/` (`pnpm db:migrate -- --name <change>`); this project only regenerates/consumes the client.
- Tests: `pnpm test` (`node --test` + esbuild with mocked Prisma/session; see `test/load-with-mocks.mjs`). `pnpm lint` also runs them (CI only calls `lint` for the client). **Temporary — do not revert `lint` to `eslint .` on its own or the tests stop running in CI**; the proper fix (own test step in `pr-ci.yml`, then `lint` back to `eslint .`) is tracked in #39. Verification = `pnpm lint` + `pnpm build` (build runs `tsc` via Next and fails on type errors).
- `postinstall` runs `prisma generate` against the server's schema, so a fresh `pnpm install` regenerates the client (requires the sibling `pos-system-server/` checkout).

## Hard rules (zero tolerance, enforced in review)

1. **Never `any`, `@ts-ignore`, `@ts-expect-error`, or eslint-disable of type rules.** Use `unknown` + narrowing, or double assertion (`as unknown as T`). React Hook Form resolvers: `yupResolver(schema) as unknown as Resolver<FormData>`.
2. **Never invent Prisma fields.** Before touching any model, open `../pos-system-server/prisma/schema.prisma` and use only fields that exist there. If a field is missing, ask the user to add it to the schema first — do not "helpfully" add it in code.
3. **Icons come from `@tabler/icons-react`**, not `lucide-react` (lucide is only present because shadcn internals use it).

## Prisma gotchas

- Client generates to a **custom path**: import from `@/generated/prisma`, never `@prisma/client` (~48 files do this).
- The generated client is **committed to git** (`/src/generated/prisma` is commented out in `.gitignore`). Expect diff churn after `prisma generate`; don't "fix" it by deleting files.
- Use the **shared instance**: `import { prisma } from '@/actions/utils'`. Never `new PrismaClient()` in actions.
- `next.config.ts` contains required Prisma plumbing (`serverExternalPackages`, `outputFileTracingIncludes`, webpack `PrismaPlugin`) — do not remove.
- All entities are soft-deleted: always filter `isDeleted: false`, and delete via `update({ isDeleted: true, deletedAt: new Date() })`. Unique constraints include `deletedAt`.
- Almost every entity is tenant-scoped: always filter by `organizationId` from the JWT/session.

## Architecture in 6 lines

- Server actions per entity in `src/actions/<entity>/`, returning `ActionResponse<T>` (`{ status, message, data }` from `@/interfaces`). **Every exported action calls `requireActor({ roles? })` from `@/lib/auth/actor`** and takes `organizationId`/`userId`/role from it — never from parameters, headers or the Zustand store; map errors with `actorErrorResponse(error)`. Validate inputs with Zod (whitelist, no spreading client objects). `test/actions-guard.test.mjs` enforces this; legacy modules still using `checkAdminRole`/`checkOrgId` are listed there as pending (#14–#15). Route handlers (`src/app/**/route.ts`) must check the session themselves (the middleware skips paths with an image extension); `test/route-handlers-guard.test.mjs` enforces it.
- Client data flow: TanStack Query hooks in `src/hooks/use<Entity>.ts` call the server actions and invalidate `queryKey: ['<entity>']`.
- Auth is custom JWT (migrated off Clerk): middleware at `src/middleware.ts` verifies the `auth-token` cookie with `jose` only for UI redirects; it adds **no** `x-user-*` headers. Server code gets identity from `getActor()`/`requireActor()`.
- **Tenancy lives in `memberships`, not in `users`** (Fase 1 paso 3): `User` is a global identity (`name`, `email`, `passwordHash`); role/org/store come from the ACTIVE membership. Auth actions compose the legacy-shaped view (`user.organizationId`, `user.role`) that the Zustand store and UI consume — a user with no membership has **no role**: `getActor()` returns FORBIDDEN and the only thing it can do is create its own organization in onboarding (`requireOnboardingUser()`, where it becomes ADMIN). Public registration creates only the user; sellers are created by the ADMIN from Users (invitations: #20).
- Zustand store (`src/store/`) persists to **sessionStorage**, not localStorage.
- UI copy and toast messages are in **Spanish**; code, identifiers, and comments in English.
- Feature pages follow `page.tsx` + `features/` subfolder (list, new/edit sheets, action component, data-table) — mirror an existing module (e.g. `src/app/dashboard/categories/`) when adding one.

## Environment

`.env` requires: `DATABASE_URL` (pooled), `DIRECT_URL` (migrations), `JWT_SECRET`, `HTTPS_ENABLED`, `UPLOADS_DIR` (product images; persistent volume in production). (The `vercel-build` script was removed — the legacy Vercel deploy is frozen on the pre-monorepo repo; migrations are applied by `pos-system-server`.)

## Git workflow

Git-flow style branches: `main` (prod), `release`, `develop`, `hotfix`. Daily work branches off `develop`; PRs target `develop` or `release`. **Commit messages use Conventional Commits** (`feat(scope): …`, `fix(scope): …`, etc.) — see the root `.opencode/skills/conventional-commits/` skill. (This supersedes the older short-imperative-sentence convention.)

## Reference docs (read when relevant)

- `CLAUDE.md` — full pattern catalog (actions, hooks, forms, sales flow)
- `.claude/agent-rules.md` — the strict typing/schema rules with examples
- `.claude/RECHARTS_CHARTS_TROUBLESHOOTING.md` — chart pitfalls (horizontal bars need `layout="vertical"`)
- Project documentation lives in the **parent repo** at `../docs/` (start with `../docs/STATUS.md`): `../docs/auth/` (JWT auth, RBAC, middleware), `../docs/deployment/` (PM2/SSL/Cloudflare, DB remote access), `../docs/features/`, `../docs/planning/`, `../docs/maintenance/`
