# Proposal: Barcode/QR scanning for POS sales (API + React Native)

## Intent

The POS system is migrating from a Next.js monolith to a pnpm monorepo (`apps/web`, `apps/api` Express + Clean Architecture, `apps/mobile` React Native, `packages/shared` types). Today sales are created in one shot (`createSale` server action) with no cart or checkout flow, and cashiers cannot scan a product code with a phone camera and have it land on an invoice. This change adds the barcode/QR POS flow against the new architecture: assign a code to each product, scan it with the React Native camera, build the sale item-by-item, and submit it to the Express API.

## Scope

### In Scope
- `POST /sales`, `GET /products/by-barcode/:code`, and product code assignment endpoints on the Express API (Clean Architecture: use case + repository + controller).
- React Native POS screen (`apps/mobile`) with a live cart backed by Zustand + AsyncStorage.
- Camera barcode/QR scanner on React Native (`react-native-vision-camera` + a FOSS barcode frame processor).
- Auto-add to cart on scan (increment qty if already present), debounce to avoid duplicate reads.
- Optional `barcodeType String?` field on `Product` (reuse existing `Product.barcode`, already unique per org).
- Label generation: QR (`qrcode`) + 1D (`jsbarcode`) for product labels, exposed as an API endpoint or shared util.

### Out of Scope
- Native iOS/Android beyond Expo + RN (no Capacitor).
- Offline-first sale sync.
- Weight-scale integration.
- Web POS fallback (the existing `apps/web` keeps its server-action sales list during migration; a web POS route is a later slice).

## Capabilities

### New Capabilities
- `pos-checkout` (mobile): scanner-driven cart, totals, customer/store selection, payment entry, and sale submission via `POST /sales`.
- `product-codes`: barcode/QR assignment on the product endpoint plus label generation/printing.

### Modified Capabilities
- `sales` (API): exposes the existing `createSale` logic as a REST endpoint, preserving the transactional stock decrement and `store.lastSaleNumber` increment.
- `products` (API): exposes product lookup by `barcode` (tenant-scoped, `isDeleted:false`, `isActive:true`, stock check).

## Approach

- **Mobile scanner: `react-native-vision-camera` (MIT, FOSS)** + a FOSS barcode frame processor (e.g. `react-native-vision-camera-barcode-scanner` or an MLKit-backed plugin). `html5-qrcode` is web-only and does NOT run on RN. On mobile, React Native uses the native camera permission (no HTTPS secure-context requirement), so `HTTPS_ENABLED` only matters for the API host.
- **Web fallback scanner (later slice): `html5-qrcode` (Apache-2.0, FOSS)**
  — retained as a note for the future web POS route; not part of this slice.
- **Alternative FOSS (note only): `@zxing/browser` + `@zxing/library`** — caveat: `library@0.23` declares `engines.node >= 24`; verify runtime before choosing.
- **Label generation: `qrcode` + `jsbarcode` (both MIT, FOSS)** — run server-side in the API to produce label payloads (SVG/PNG) for the product module.
- **Paid options (note only, not recommended):** Scandit and Dynamsoft Barcode Reader — best-in-class accuracy, per-device licensing; revisit only if FOSS accuracy is poor on target phones.
- **Auth contract:** the API reads `organizationId`, `userId`, `storeId` from the verified JWT (jose) — never from the request body. Mobile persists `auth-token` in AsyncStorage and attaches it to every request.
- **Flow:** scanner → `GET /products/by-barcode/:code` → use case validates tenant + active + stock → add/increment in `usePosCart` (Zustand + AsyncStorage) → review totals/payments → `POST /sales` (single transactional use case, same invariants as the current `createSale`).
- **Shared contract:** request/response DTOs and zod schemas for sales and product-by-barcode live in `packages/shared`, consumed by both mobile and (later) web.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` (moved to `apps/api/prisma/`) | Modified | Add optional `barcodeType String?` to `Product`; reuse existing `barcode` + `unique_barcode_per_org` |
| `apps/api/src/domain/entities/product.ts` | New | Product entity with `barcode`, `barcodeType` |
| `apps/api/src/domain/repositories/product.repository.ts` | New | Interface incl. `findByBarcode(orgId, code)` |
| `apps/api/src/domain/repositories/sale.repository.ts` | New | Interface preserving the transactional create + stock decrement + `lastSaleNumber` |
| `apps/api/src/application/use-cases/sale/create-sale.use-case.ts` | New | Orchestrates SaleRepository + StockMovementRepository inside a Unit of Work (mirrors current `createSale` transaction) |
| `apps/api/src/application/use-cases/product/get-product-by-barcode.use-case.ts` | New | Tenant-scoped lookup + validation |
| `apps/api/src/infrastructure/http/controllers/sales.controller.ts` | New | `POST /sales` controller |
| `apps/api/src/infrastructure/http/controllers/products.controller.ts` | New | `GET /products/by-barcode/:code` controller |
| `apps/api/src/infrastructure/http/routes/` | New | Sales + product routes, behind `authenticate` + RBAC |
| `packages/shared/src/schemas/sale.ts`, `product.ts` | New | zod request/response DTOs, shared with mobile |
| `apps/mobile/src/screens/pos/` | New | POS screen: scanner + cart + summary + payment |
| `apps/mobile/src/store/usePosCart.ts` | New | Zustand cart store, AsyncStorage persistence |
| `apps/mobile/src/api/products.ts`, `sales.ts` | New | TanStack Query hooks calling the API |
| `apps/mobile/src/components/BarcodeScanner.tsx` | New | `react-native-vision-camera` scanner wrapper |
| `apps/mobile/app.json` | Modified | Camera permission strings |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| RN barcode frame processor license/compat varies | Medium | Pin a FOSS plugin; verify license before adding; keep scanner component swappable |
| Low-end phones scan slowly | Medium | Limit frames per second, restrict scanned formats (EAN-13, UPC-A/E, QR, CODE_128) |
| Duplicate rapid reads add过量 qty | Medium | Debounce + per-product min interval; "already in cart" toast |
| Code not found / product inactive / stock 0 | Medium | Spanish error toast on mobile; use case returns typed errors mapped to HTTP status |
| Transacción de sale rota al cambiar de capa | Medium | Use case reuses existing logic verbatim; integration tests with `supertest` + real Prisma (test DB) |
| Auth token handling differs web vs mobile | Low | API accepts JWT from header (`Authorization: Bearer`) for mobile and from cookie for web — both verify with jose |
| Dual source of truth during migration | Medium | Disable each server action as its API endpoint lands; never keep both active for the same module |

## Rollback Plan

Reverted by (1) removing `apps/mobile/src/screens/pos/`, the mobile cart store, scanner component, and the mobile API hooks, (2) removing the new API routes/controllers/use-cases (domain entities can stay), and (3) dropping the optional `barcodeType` column via a Prisma migration. The existing web sales flow via server actions is untouched during this slice, so the rest of the app keeps working.

## Dependencies

- `react-native-vision-camera` (MIT, FOSS) — mobile scanner
- FOSS barcode frame processor plugin (to be pinned, verify license)
- `qrcode` (MIT) — QR generation (API-side)
- `jsbarcode` (MIT) — 1D generation (API-side)
- Existing / new: Express, `@prisma/client`, `jose`, `zod`, TanStack Query, Zustand, React Hook Form
- `packages/shared` DTOs and schemas

## Success Criteria

- [ ] Cashier scans a product code with the phone camera and the line appears in the cart within ~1 s.
- [ ] Re-scanning the same code increments quantity instead of duplicating.
- [ ] Unknown/inactive/out-of-stock codes show a Spanish error toast and are not added.
- [ ] Submitting the cart calls `POST /sales` and creates a sale with correct totals, stock decrement, and `saleNumber` increment (verified by integration test).
- [ ] Product endpoint can save a code and the label endpoint returns a QR/1D payload.
- [ ] Works on iOS and Android via Expo without a wired HTTPS-only constraint on the app itself (API host must be HTTPS in prod).