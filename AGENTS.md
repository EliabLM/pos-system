# AGENTS.md

Workspace root. The POS system is being **migrated from a single app into 3 projects**: `pos-system-client/`, `pos-system-server/`, `pos-system-app/`.

- Today all code lives in **`pos-system-client/`** (Next.js 15 POS app, git repo, pnpm). `pos-system-server/` and `pos-system-app/` are **empty placeholder directories** — do not scaffold into them until the migration starts.
- **All project documentation lives in this root at `docs/`** — **read `docs/STATUS.md` first**: it is the single source of truth for project state and the next step. When you finish a task that changes project state, update `docs/STATUS.md` in the same change.
- New docs go in the matching `docs/` category folder (`auth/`, `deployment/`, `features/`, `maintenance/`, `planning/`; new feature = new `features/<name>/` folder) and must be added to the `docs/README.md` index. Docs are written in Spanish.
- Project-specific skills live in `.opencode/skills/`: `frontend-design` (visual direction & identity), `interface-design` (product UI craft — hierarchy, tokens, states, polish), `react-best-practices` (Vercel perf rules — router indexes 70 rules under `rules/`, full guide in `RULES-FULL.md`), `postgresql-table-design` (Postgres schema design + this project's tenant/soft-delete/Prisma conventions + migration targets), `node-clean-architecture` (Clean Architecture + SOLID spine for the Node.js server), `node-best-practices` (goldberg-derived operational craft — errors, security, testing, prod hardening), `react-native-expo` (Expo Router, dev builds, EAS Build/Update, offline-first persistence + barcode scanning for the mobile app), and `conventional-commits` (enforced commit message format + scopes per project).
- Keep this file current: when workspace structure, project layout, or conventions change, update it in the same change.
- This root is **not a git repo**; run git commands inside `pos-system-client/`.
- Run all commands (`pnpm dev|lint|build`, prisma, etc.) from `pos-system-client/`, never from here.

**Read `pos-system-client/AGENTS.md` before doing any work.** It contains the commands, hard typing/Prisma rules, and architecture conventions that are enforced in review. `pos-system-client/CLAUDE.md` has the full pattern catalog.
