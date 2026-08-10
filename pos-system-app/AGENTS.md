# AGENTS.md

`pos-system-app` — the POS mobile app, **React Native + Expo (SDK 57, expo-router)**.

- This is a pnpm workspace project. Run commands from here, never from the parent root.
- **Read the root `../AGENTS.md` first** for the monorepo map, then `../docs/STATUS.md` for project state and next step.
- **Load the `react-native-expo` skill** (`.opencode/skills/react-native-expo/`) before writing any feature code — it encodes the project's Expo conventions (dev builds vs Expo Go, offline persistence, barcode scanning, sync discipline).
- **Expo SDK 57 is current** — the API surface changes between SDKs. When in doubt about an API, check the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code.
- Strict TypeScript (`tsconfig.json` extends `expo/tsconfig.base` + `strict: true`). No `any`/`@ts-ignore` — project-wide policy.
- UI copy in Spanish; code/identifiers in English. Design tokens shared with the web client (target: `packages/design-tokens`).
- `src/app/` is the expo-router directory (file-based routes). Path alias `@/*` → `./src/*`.
- The server API this app will consume lives in `../pos-system-server/` (Express + Clean Architecture). DTOs will be shared via `packages/dto-types`.
- Current state: fresh scaffold from `create-expo-app --template default`. No business features yet — Fase 4 of the migration plan adds auth, sync, and the sales/scanner flow.
