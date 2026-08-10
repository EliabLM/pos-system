# @pos/server

Node.js 22 LTS + Express 5 + TypeScript API for the POS system, built on Clean Architecture + SOLID.

See `../docs/planning/migracion-3-proyectos.md` for the migration plan and `../.opencode/skills/node-clean-architecture/` + `node-best-practices/` for the enforced conventions.

## Commands

```bash
pnpm dev          # tsx watch — hot reload
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm lint         # ESLint (flat config, strict TS)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm test:watch   # vitest watch
```

## Layout (minimal — Fase 2+ populates modules)

```
src/
├── app.ts                       # Express instance (importable by supertest, no port binding)
├── server.ts                    # boots on PORT, graceful shutdown
├── config/env.ts                # Zod-validated env (fail-fast at boot)
├── shared/
│   ├── domain/errors.ts         # DomainError hierarchy → mapped by errorHandler
│   └── infra/http/errorHandler.ts
├── health/health.route.ts       # /api/v1/health, /api/v1/ready
└── app.test.ts                  # supertest wiring tests
```
