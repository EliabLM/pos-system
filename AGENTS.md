# AGENTS.md

Workspace root — **monorepo git** (`https://github.com/EliabLM/pos-system`, branch `main`). The POS system is being **migrated from a single app into 3 projects**: `pos-system-client/`, `pos-system-server/`, `pos-system-app/`.

- This root **is a git repo**. Run git commands from here. `pos-system-client/` has no nested `.git` (imported via subtree, history flattened).
- `pnpm-workspace.yaml` active. Members: `pos-system-server`, `pos-system-app`, `packages/*`. `pos-system-client/` stays self-managed by its own `pnpm-lock.yaml` until Fase 5 of the migration (strangler-fig).
- `pos-system-client/` — Next.js 15 POS app, pnpm 10.7.1. Still the only project with business logic.
- `pos-system-server/` — Express 5 + TypeScript, Clean Architecture scaffold (no domain modules yet — Fase 2+).
- `pos-system-app/` — Expo SDK 57 + expo-router, fresh scaffold (no business features yet — Fase 4).
- `packages/` — `dto-types`, `api-client`, `design-tokens` (scaffolds, empty).
- **All project documentation lives in this root at `docs/`** — **read `docs/STATUS.md` first**: it is the single source of truth for project state and the next step. When you finish a task that changes project state, update `docs/STATUS.md` in the same change.
- New docs go in the matching `docs/` category folder (`auth/`, `deployment/`, `features/`, `maintenance/`, `planning/`; new feature = new `features/<name>/` folder) and must be added to the `docs/README.md` index. Docs are written in Spanish.
- Project-specific skills live in `.opencode/skills/`: `frontend-design` (visual direction & identity), `interface-design` (product UI craft — hierarchy, tokens, states, polish), `react-best-practices` (Vercel perf rules — router indexes 70 rules under `rules/`, full guide in `RULES-FULL.md`), `postgresql-table-design` (Postgres schema design + this project's tenant/soft-delete/Prisma conventions + migration targets), `node-clean-architecture` (Clean Architecture + SOLID spine for the Node.js server), `node-best-practices` (goldberg-derived operational craft — errors, security, testing, prod hardening), `react-native-expo` (Expo Router, dev builds, EAS Build/Update, offline-first persistence + barcode scanning for the mobile app), and `conventional-commits` (enforced commit message format + scopes per project).
- Claude Code mirrors: each `.opencode` skill has a thin wrapper in `.claude/skills/` (the `.opencode` files remain the source of truth — edit those). The `playwright-test` MCP server from `opencode.json` is mirrored in `.mcp.json`, and the three Playwright subagents (`playwright-test-planner` / `-generator` / `-healer`, prompts in `.opencode/prompts/`) are mirrored in `.claude/agents/`. When a skill, prompt, or MCP config changes, update its mirror in the same change.
- Keep this file current: when workspace structure, project layout, or conventions change, update it in the same change.

**Read `pos-system-client/AGENTS.md` before doing any work.** It contains the commands, hard typing/Prisma rules, and architecture conventions that are enforced in review. `pos-system-client/CLAUDE.md` has the full pattern catalog.
