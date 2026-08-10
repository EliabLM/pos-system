---
name: conventional-commits
description: Enforce Conventional Commits across the monorepo — message format, scopes per project, and breaking-change notation. Trigger: creating a commit, writing a commit message, splitting work into commits, or amending/reviewing commit history.
---

# Conventional Commits

Every commit in this repo uses the [Conventional Commits](https://www.conventionalcommits.org/) spec. No exceptions, no freeform messages. This is what makes history readable, changelogs generatable, and release tooling work.

## Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

- **`<type>`** — one of the fixed set below. Lowercase, no alternatives.
- **`<scope>`** — the monorepo project or package the change belongs to (see Scopes). Optional but expected for most commits.
- **`<subject>`** — imperative, lowercase, no trailing period, ≤72 chars. "add sale endpoint", not "Added sale endpoint." or "adds sale endpoint".
- **body** — wrapped at ~72 cols; explain *why*, not *what* (the diff shows what).
- **footer** — `BREAKING CHANGE: <description>` for breaking changes; `Refs: #123` / `Closes: #123` for issue links.

## Types (closed set)

| Type | Use for |
|------|---------|
| `feat` | New feature visible to users or API consumers |
| `fix` | A bug fix |
| `refactor` | Code restructuring with no behavior change |
| `perf` | Performance improvement |
| `docs` | Documentation only (docs/, READMEs, AGENTS.md, skill files) |
| `test` | Test additions or corrections, no prod code |
| `build` | Build system, deps, lockfile, workspace config |
| `ci` | CI pipeline / GitHub Actions |
| `chore` | Misc repo tasks not covered above (rare — prefer the specific type) |
| `style` | Formatting/whitespace only, no logic |
| `revert` | Reverting a previous commit (`revert: <original subject>`) |

**Do not invent types.** If nothing fits, it's `chore` — and that should be rare.

## Scopes (this monorepo)

Scope = the project or package the change primarily belongs to. One scope per commit; if a change spans two projects, it's almost always two commits.

| Scope | When |
|-------|------|
| `server` | `pos-system-server/` |
| `app` | `pos-system-app/` |
| `client` | `pos-system-client/` (web — until absorbed in Fase 5) |
| `dto-types` | `packages/dto-types/` |
| `api-client` | `packages/api-client/` |
| `design-tokens` | `packages/design-tokens/` |
| `docs` | `docs/` (root) |
| `skills` | `.opencode/skills/` |
| `workspace` | root-level: `pnpm-workspace.yaml`, root `.gitignore`, root `AGENTS.md` |
| *(omit)* | cross-cutting single-file changes with no clear scope |

## Breaking changes

Two equivalent forms:

```
feat(server)!: drop legacy cuid IDs in responses

BREAKING CHANGE: all entity IDs are now UUIDv7; clients must accept UUID strings.
```

or in the footer:

```
feat(server)!: return UUIDv7 instead of cuid for sale IDs
```

The `!` after the type/scope flags it; `BREAKING CHANGE:` in the footer explains it. Use both together for anything non-obvious.

## Examples

```
feat(server): add POST /api/v1/auth/login endpoint
fix(client): correct soft-delete filter on sale list
refactor(app): split sale checkout into use-case + adapter
docs: add migration plan for 3-project split
docs(skills): add conventional-commits skill
build(workspace): add pnpm-workspace.yaml and root .gitignore
ci: add lint+typecheck+test workflow per project
test(server): cover auth login use-case with in-memory repo
perf(server): index organization_id on sale table
```

## Commit sizing (review-friendly)

- One logical change per commit. A feature + its tests in one commit is good; a feature + unrelated refactor is two commits.
- A commit should build and pass tests on its own (bisectable). If the feature needs a follow-up to compile, reorder or squash.
- Work-unit granularity: a reviewer should understand a commit from the message + diff without context from other commits.
- Reference the work-unit-commits skill for splitting larger changes into reviewable slices.

## Anti-patterns

- `update` / `misc` / `wip` / `stuff` — no type, no information.
- `feat: add thing and also fix other thing` — two concerns, two commits.
- `Feat(Server): Add Thing` — wrong case (lowercase `feat`, lowercase subject, scope is lowercase).
- Subject > 72 chars or with a period.
- Body that restates the diff ("changed file X to call Y") — say *why*.
- Mixing `BREAKING CHANGE:` without the `!` marker, or vice versa.
- Conventional Commits only sometimes — consistency is the whole value.

## Tooling note

The repo does not yet enforce this with commitlint/husky. Until it does, the discipline is manual and enforced in review. (Adding commitlint is a welcome `build(workspace)` or `ci` commit.)

---

*Conventional Commits 1.0.0 — https://www.conventionalcommits.org/*
