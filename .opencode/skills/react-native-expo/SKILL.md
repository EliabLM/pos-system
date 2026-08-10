---
name: react-native-expo
description: Build and operate `pos-system-app`, the POS mobile app built with React Native + Expo. Covers Expo Router, dev builds vs Expo Go, EAS Build/Update, offline-first persistence, barcode/QR scanning, and the project's conventions. Trigger: scaffolding or working in the `pos-system-app` project, adding a feature with native needs (camera, storage, background work), or designing the app's navigation/data flow.
---

# React Native + Expo (pos-system-app)

The mobile POS app is **React Native + Expo**. This skill is the operational rulebook — the stack choices that are easy to get wrong on a first Expo project, plus the project-specific moves for a multi-tenant POS with offline + scanner needs.

> **Verified against current Expo docs** (Context7, `/expo/expo`). Where this skill states an API name or behavior, it is what the current SDK documents — not the 2021-era API that many guides still show.

## Stack decisions

- **Expo, managed workflow with `expo-dev-client` (development builds), NOT Expo Go.** This is non-negotiable for this project: barcode scanning, custom native modules, app-specific deep links, custom app identity (name/icon/bundle id) all require your own native build. Expo Go is a playground with a fixed set of bundled native libraries — it will error the moment you call native code that isn't already in it. Plan for a dev build from day one.
- **Expo Router** (file-based routing, like Next.js App Router — the team already knows that mental model). New-style API: `expo-router`, mounted via root `app/_layout.tsx`. Enable typed routes in `app.json`:
  ```json
  { "expo": { "scheme": "pos-system", "experiments": { "typedRoutes": true } } }
  ```
  Navigate with typed `Href` (`router.push('/sales/123' as Href)`) — type-safe, no stringly-typed routes.
- **TypeScript strict** — same `no any` policy as the rest of the workspace.
- **Node 22 LTS**, **pnpm**, single lockfile (`pnpm-lock.yaml`) committed.

## Dev builds: the workflow the skill wants you to internalize

- Local dev: `npx expo start --dev-client` (targets your installed dev build, not Expo Go).
- Build a dev build on a device/simulator: `eas build --platform android --profile development` (and `ios`). The `development` profile in `eas.json` must include `expo-dev-client` and `expo-updates` if you want OTA.
- A dev build is *your* app: logs, dev menu, custom native modules, push notifications, deep links — all available. Expo Go has none of these reliably.
- This is the single biggest stumbling block for newcomers: **"why doesn't my camera/Firebase/custom module work in Expo Go?"** — because Expo Go can't load native code it didn't ship with. Use a dev build.

## EAS Build / EAS Update (release pipeline)

- **EAS Build** builds signed iOS/Android binaries in the cloud (or locally with `--local`). Profiles in `eas.json`: `development`, `preview`, `production`.
- **EAS Update** ships JS bundles OTA to already-installed builds (no store review for JS-only changes). Pair with `expo-updates` in the build. Channel-based: a build checks an update channel; promote an update from staging → production by repointing the channel, not by rebuilding.
- **Never** push a native-code change via EAS Update — `eas update` is JS-only. A change to `app.json` native config, a new native dependency, or a SDK bump requires a new build via EAS Build.
- Production deploys: build → submit to stores (`eas submit`) or distribute via EAS Update on the production channel. The plan should pick one strategy; recommendation: store builds for native changes, EAS Update for hotfix JS.

## Navigation (Expo Router)

- File-based: `app/` directory; `index.tsx`, `sales/[id].tsx` (dynamic), `(tabs)/_layout.tsx` (group with shared layout, doesn't add a path segment), `+not-found.tsx` for 404.
- Layouts compose: a root `Stack` wraps a `(tabs)` group plus modal screens outside the tabs (`<Stack.Screen name="modal" options={{ presentation: 'modal' }} />`).
- Splash screen: `expo-splash-screen` — `preventAutoHideAsync()` while fonts/assets load, then `hideAsync()`. Never flash white.
- **Auth gate pattern:** root layout reads an auth state (from `expo-secure-store`, see below) and redirects to `/login` if unset, before rendering protected routes. Use `<Redirect>` from `expo-router`.
- Per-theme theming uses `ThemeProvider` with `DarkTheme`/`DefaultTheme` from `expo-router` (or your own design tokens — cross-reference the `frontend-design` / `interface-design` skills; dark/light both *designed*, never defaulted).

## Offline-first persistence (this POS needs it — `docs/features/offline-mode/`)

- **Auth tokens → `expo-secure-store`** on native (Keychain iOS / Keystore Android), never `AsyncStorage` (unencrypted). Mirror to `localStorage` on web if the project builds web too. The Expo auth docs ship a `useStorageState` hook that does exactly this — reuse it.
- **Transactional/business data offline → `expo-sqlite`** (local SQLite) as the source of truth while offline, syncing to the server when connectivity returns. For heavier reactive local data with sync, evaluate **WatermelonDB** (syncs a local DB with Postgres); **TinyBase**/**y-expo-sqlite** for collaborative-style state.
- **Don't reach for AsyncStorage for app data** — it's a string key-value bag, unencrypted and not queryable. It's fine for trivia (theme preference); not for the offline cart, sale queue, or anything that has to survive a crash and reconcile with the server.
- **Sync discipline:** the/server is the authority. Generate IDs locally with **UUIDv7** (mirrors the DB skill — generable offline, mergeable). Queue outbound mutations (sale created offline) with an idempotency key so a retry after reconnect doesn't double-post. The server side already plans idempotency-key support (see `node-best-practices` POS bonus).
- **Backup conflict resolution on reconnect:** last-write-wins is usually wrong for money — design the sync like a ledger of events (each line item/adjustment is an immutable record), not as state overwrites.

## Barcode / QR scanning (this POS needs it — `openspec/add-barcode-pos-scanning/`)

- Use **`expo-camera`** `CameraView`, not a third-party scanner lib.
  ```tsx
  const [permission, requestPermission] = useCameraPermissions();
  // … gate on permission.status === 'granted'
  <CameraView
    facing="back"
    barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','upc_a','qr','code128'] }}
    onBarcodeScanned={scanningEnabled ? handleScan : undefined}
  />
  ```
- **Dedup explicitly:** `onBarcodeScanned` fires for *every* frame the symbol is visible. Gate it: after a successful scan, set the callback to `undefined` (or a flag-based no-op) and re-enable only after a cooldown or the user re-arms. Without this, the scanner fires repeatedly and floods your handler.
- **Permissions first, always.** Use `useCameraPermissions()`; never assume granted. Show a sober denial state with a "open settings" affordance.
- **iOS quirk:** iOS reports UPC-A as EAN-13 with a leading `0` (AVFoundation has no distinct UPC-A symbology). The Expo SDK normalizes this back to the real UPC-A value, but if you compare raw scanned strings cross-platform, normalize `ean13`-with-leading-`0` to the shorter value before lookup. Test UPC-A barcodes against both platforms.
- Camera access requires a **dev build** — reiterating: it works in Expo Go only because `expo-camera` happens to be one of the libs Expo Go bundles, but you'll be shipping a dev build anyway for the other native needs; don't develop against Expo Go and then be surprised in your dev build.

## Conventions carried over from the workspace

- **Strict TS, no `any`/`@ts-ignore`.** Use `unknown` + narrowing.
- **UI copy in Spanish**, sentence case; code/identifiers in English. (Same as the web client.)
- **`@tabler/icons-react`** is the icon set on web; for native, **the team should pick ONE icon set and centralize it** — likely `@expo/vector-icons` wrapping a single family (e.g. `@tabler/icons-react-native` if it exists for the target SDK, or MaterialCommunityIcons). Don't let three icon families accrete.
- **Design tokens shared with the web app** — the goal is one palette/spacing scale declared once and consumed by both projects. Where possible, factor the design tokens into a workspace package. Both projects must NOT diverge into two unrelated design languages.
- **TanStack Query** for server data on the app too (matches the web client's data-flow conventions) — one cache layer, invalidation by queryKey, retry/offline behavior configured. Don't hand-roll fetch state.
- **State management:** Zustand persists to storage (the web app uses sessionStorage; on native, persist via `expo-secure-store` for auth-relevant slices and `expo-sqlite`/AsyncStorage for the rest). Don't double-store the same slice in two places.

## Recommended project shape

```
pos-system-app/
├── app/                    # expo-router routes (file-based)
│   ├── _layout.tsx         # root: auth gate, providers, splash
│   ├── (tabs)/
│   │   ├── _layout.tsx     # tab navigator
│   │   ├── sales.tsx       # POS checkout / sale flow (focal screen)
│   │   ├── catalog.tsx     # product browse + scan-to-add
│   │   └── reports.tsx
│   ├── sales/[id].tsx      # sale detail / receipt
│   ├── login.tsx
│   └── +not-found.tsx
├── src/
│   ├── features/          # sale flow, scanner, offline-sync (non-route logic)
│   ├── data/              # API client, TanStack Query hooks, types (mirror server DTOs)
│   ├── store/             # Zustand slices (auth, cart, ui)
│   ├── persistence/       # expo-sqlite schema + sync queue + reconciler
│   ├── ui/                # design system: tokens, primitives (shared with web ideally)
│   └── shared/            # errors, utils
├── app.json / app.config.ts
├── eas.json               # development / preview / production profiles
└── package.json
```

## Anti-patterns (review-blocking)

- Shipping against Expo Go for a production app that needs native modules. Dev build from the start.
- Hardcoded API URLs / no offline-queue — a POS used on a shop floor loses connectivity; an un-queued sale is lost revenue.
- AsyncStorage for tokens — use `expo-secure-store`.
- Third-party barcode scanner when `expo-camera` CameraView does it natively and stays version-aligned with the SDK.
- Scanner firing every frame (missing dedup) — UX disaster (même scan → même producto diez veces).
- Diverging design tokens from the web app — pick once, share.
- `eas update` for a native change — wrong tool; rebuild.
- Treating `expo-sqlite` as a cache (overwrite state) instead of as an event ledger (append, reconcile) — leads to money reconciliation bugs after reconnect.

## Pointers

- `frontend-design` / `interface-design` — UI craft (dark/light designed, hierarchy, states, scanner-screen keyboard-first/scan-first focus management).
- `postgresql-table-design` — UUIDv7 generation works client-side; idempotency keys align with the server's.
- `node-best-practices` — server-side idempotency-key endpoint contract the app relies on for offline sync.

---

*Authored for the POS app (`pos-system-app`), React Native + Expo. API specifics verified against current Expo docs (Context7 /expo/expo) for Expo Router (`typedRoutes`, `Href`), dev builds vs Expo Go, `expo-camera` `CameraView` barcode scanning, and `expo-secure-store` auth-token persistence.*