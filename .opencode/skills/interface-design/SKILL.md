---
name: interface-design
description: Craft-first interface design for this POS product UI — dashboards, data tables, checkout/sale flow, settings, forms, data interfaces. Trigger: designing, building, reviewing, auditing, or refining product UI where hierarchy, tokens, states, or design-system consistency matter. Not for marketing/brand work — use frontend-design for visual direction and identity.
---

# Interface Design

Build product interfaces with the craft of a top design team — Linear, Vercel, Stripe, Apple. The difference is not talent: every decision was *decided*, the hierarchy is unmistakable, and a hundred small details are correct at once.

**The bar:** If another AI, given a similar prompt, would produce substantially the same output, you have failed. Not different for its own sake — different because the interface emerged from *this* user, *this* task, *this* world.

Scope boundary: this skill governs **product UI craft** (hierarchy, tokens, states, polish). For visual direction, identity, and the one-signature-element brief, use `frontend-design` first, then execute with this discipline.

---

## The Problem

You will generate generic output. Training has seen thousands of dashboards and the patterns are strong; you can follow the whole process and still produce a template. Intent lives in prose, code generation pulls from patterns — and in that gap, defaults win. Catch yourself.

**Where defaults hide** (they disguise as infrastructure):
- **Typography feels like a container** — type isn't holding your design, it *is* your design. Reaching for the usual font is not designing.
- **Navigation feels like scaffolding** — navigation *is* the product: where you are, where you can go, what matters.
- **Data feels like presentation** — a number on screen is not design. What does it *mean* to the cashier looking at it?
- **Token names feel like detail** — someone reading only your tokens should guess what product this is.

There are no structural decisions. Everything is design.

---

## Intent First

Before touching code, answer (compact working brief):
- **Who is this human?** Not "users." The cashier mid-shift with a line of customers. The admin closing the register at night. The owner checking today's numbers from their phone. Each is a different screen.
- **What must they accomplish?** The verb. Ring up this sale. Find why cash is short. Restock a product. It determines what leads, what follows, what hides.
- **What should this feel like?** In words that mean something — "clean and modern" means nothing. Fast like a scanner beep? Calm like a ledger? Dense like a cash wrap counter?

If the prompt is too vague, ask one concise question; if context allows a responsible assumption, state it and proceed.

**Intent must be systemic.** If the intent is fast: density, keyboard flow, no blocking animation — all fast. Check every token against the stated intent. For every choice you must be able to say *why*; "it's common" means you defaulted.

## Product Domain Exploration

Produce all four before proposing any direction:
- **Domain** — concepts/metaphors/vocabulary from retail: tickets, tills, barcode beeps, cash drawers, SKUs, end-of-day Z-reports. Not features — territory. Minimum 5.
- **Color world** — colors that exist *naturally* in this world: thermal paper white, ink-ribbon black, scanner-laser red, "PAID" stamp green. List 5+.
- **Signature** — one element that could only exist for THIS product. Can't name one? Keep exploring.
- **Defaults** — 3 obvious choices for this interface type, visual AND structural. You can't avoid patterns you haven't named.

**The test:** read your proposal with the product name removed — could someone identify what it's for?

---

## Visual Hierarchy & Composition

The biggest driver of "designed" vs "generated." Defaults produce *flatness*; craft produces *hierarchy*.

- **One focal point per view.** Name it out loud before building, then make it win (size, contrast, position, whitespace). Demote everything else deliberately. In the sale screen, the focal point is the running total and the charge action — not the logo.
- **Type scale is a ratio, and weight beats size.** ~1.2 for dense UI, 1.25 for most, 1.333 for expressive. From 14px body at 1.25: `caption 11 · body 14 · h4 16 · h3 18 · h2 22 · h1 28 · display 44+`. The Apple/Linear move: one 14px size holds three tiers through weight + opacity alone — `value 600/primary · label 500/secondary · meta 400/muted`. Build from size + weight + color together, never size alone. Squint: can't tell headline from body from label? Hierarchy too weak.
- **Density is a decision, expressed in px.** A POS is a workbench: tool panels at 12–16px padding, not 24px brochure air. Name the values up front and hold them.
- **Spatial rhythm — breathe unevenly.** Dense control zones give way to open content; monotone same-card-same-gap layouts are the sound of no one deciding.
- **Proportions speak.** A 280px sidebar vs 360px says different things about what matters. Articulate what each proportion declares.
- **~60/30/10.** Dominant neutral surface, secondary tone, ~10% accent. One accent, used with intention. Gray builds structure; color *communicates* (status, action, identity).
- **Optical sizing:** tighten tracking as type gets bigger; body line-height ~1.5.

## Craft Foundations

**Subtle layering (the backbone).** You should barely notice the system working.
- **Surface elevation:** numbered levels, each jump a few percentage points of lightness; light mode stays light and adds shadow instead.
- **Sidebars:** same background as canvas + subtle border — different colors fragment the space.
- **Dropdowns/popovers:** one level above their parent surface.
- **Inputs:** slightly *darker* than surroundings — inset surfaces signal "type here."
- **Borders:** low-opacity rgba (`rgba(255,255,255,0.06–0.12)` dark, slightly higher light); disappear until you need them.
- **Squint test:** hierarchy perceivable, nothing jumps out. Get this wrong and nothing else matters.

**Infinite expression.** A metric can be hero number, inline stat, sparkline, gauge, delta badge. Same sidebar + same card grid + icon-left-number-big metric boxes = AI-generated, immediately. Ask: what's the ONE thing users do here, and what product solves a similar problem brilliantly?

**Color lives somewhere.** Walk into the physical version of this space — materials, light, objects. The palette should feel like it came FROM the retail world, not applied TO a template.

---

## Before Writing Each Component

Mandatory checkpoint — state it:

```
Intent:     [who, what must they do, how should it feel]
Hierarchy:  [focal element and how it wins]
Palette:    [colors from the exploration — and WHY this world]
Depth:      [borders / shadows / layered — WHY it fits the intent]
Surfaces:   [elevation scale — WHY this temperature]
Typography: [typeface + size/weight/color levers — WHY]
Spacing:    [base unit + chosen density]
```

Can't explain WHY for each? You're defaulting — stop and think.

---

## Use What Exists

The most common way AI degrades this codebase: hand-rolling what's installed. A bespoke `<div onClick>` beside the real `Button`. Before building a control, look at what the project gives you.

**Controls: native → primitive → hand-roll.**
1. **Native HTML first.** `<button>`, `<a>`, `<dialog>`, `<details>`. Never `<div onClick>` — you lose focus, keyboard, semantics.
2. **Installed primitives for anything stateful.** This project already ships Radix (dialog, dropdown, popover, select, tabs, tooltip…), `cmdk`, `vaul`, `sonner` — they bring keyboard nav, focus trap, ARIA, positioning. Compose and style them; "build custom" means *style a primitive*, not rewrite behavior.
3. **Hand-roll only as last resort**, then owe the full contract: keyboard nav, focus trap/return, ARIA, click-outside, scroll-lock. POS flows are keyboard-first (scanner input) — a control that breaks keyboard flow breaks the product.

**Styling: system → component → token → utility.**
1. Use the design system: `<Button variant="…">`, CVA variants, existing shadcn components before one-offs. Match Tailwind conventions; don't introduce another styling approach.
2. Same utility string twice → extract a component (second real reuse, not first).
3. Bind to semantic tokens (`bg-card border-border text-muted-foreground`), never hardcoded `gray-200`/`#fff`. Hardcoded literals break theming and dark mode.
4. Inline utilities are for genuine one-offs.

---

## Design System Essentials

- **Tokens:** every color traces to primitives (foreground/background/border/brand/semantic). No random hex.
- **Text hierarchy — four levels:** primary / secondary / tertiary / muted. Two levels = too flat.
- **Spacing:** base unit 4px, multiples only; micro / component / section / major scales.
- **Padding symmetrical** unless content genuinely demands otherwise.
- **Depth — choose ONE and commit:** borders-only · subtle shadows · layered shadows · surface-color shifts. Never mix.
- **Border radius — a scale:** small inputs/buttons, medium cards, large modals.
- **Control tokens:** inputs/selects/checkboxes get dedicated bg/border/focus tokens, tuned independently of surfaces.
- **Dark mode:** shadows are weak on dark — lean on borders; desaturate semantics slightly; one hue, shift only lightness. Both themes *designed*, not defaulted.

---

## Polish & Motion Essentials

**Static polish:** concentric radius (`outer = inner + padding`) · `tabular-nums` on every dynamic number (prices, quantities, totals — non-negotiable in a POS) · optical alignment (icon-side padding ≈ text-side − 2px) · **states are not optional** (default/hover/active/focus/disabled; loading/empty/error for data — in Spanish, see frontend-design for copy voice) · hit areas 44×44px (touch terminals), 40 minimum, never overlapping · light-mode lift = layered transparent shadows + 1px ring; dark mode collapses to a single ring · `text-wrap: balance` headings / `pretty` body · antialiased root · 1px inset `rgba` image outlines.

**Motion — felt, not watched:**
- **Actions repeated 100+×/day (add item, tender, confirm) get NO animation** — it makes the till feel slow. Occasional surfaces (sheets, dialogs, toasts) get standard animation.
- Duration < 300ms UI-wide; button press 100–160ms; popovers 125–200ms; drawers 200–500ms.
- Custom ease-out `cubic-bezier(0.23, 1, 0.32, 1)` for entering; never `ease-in`.
- Press feedback `scale(0.97)` on `:active` (never below 0.95). Never animate from `scale(0)` — start at 0.95 + opacity 0.
- Popovers scale from their trigger; modals stay centered.
- Only animate `transform` and `opacity`; never `transition: all`.
- Stagger entrances 30–80ms; exits faster and subtler.
- Respect `prefers-reduced-motion`.

---

## Avoid

Harsh borders · dramatic surface jumps · flat hierarchy · monotone layout · inconsistent spacing (clearest sign of no system) · mixed depth strategies · missing states · dramatic drop shadows · large radius on small elements · decorative gradients/color · multiple accents · different hues per surface · default typography · structural hacks (negative margins undoing parent padding, escape-hatch `calc()`, absolute positioning to dodge layout flow).

---

## Workflow

1. Inspect the existing app, tokens, component patterns, and `.interface-design/system.md` if present.
2. Make the domain exploration concrete (all four outputs) before choosing layout/color/type/density/nav.
3. When direction is ambiguous or costly to change, lead with the Suggest + Ask block, then confirm: "Does that direction feel right?"

```
Domain:     [5+ concepts from the product's world]
Color world:[5+ colors that exist in this domain]
Signature:  [one element unique to this product]
Rejecting:  [default] → [alternative] ×3
Direction:  [approach connecting to the above]
```

4. Patch the implementation, then run `pnpm lint` / `pnpm build` in `pos-system-client/`.
5. **Verify visually for non-trivial UI:** run the dev server and take screenshots at desktop and mobile widths; fix overlap, broken spacing, blank states, unreadable text before presenting. A rendered default is still a default.
6. Keep user-facing updates short — surface the decision, not the design monologue. Don't announce modes.

**The checks (before showing):** swap test (swap typeface/layout for the usual — would anything feel different?) · squint test (hierarchy readable, nothing harsh?) · signature test (point to five specific elements where the signature appears) · token test (read your CSS variables aloud — do they belong to *this* product's world?).

## After Completing a Task

Offer: "Want me to save these patterns for future sessions?" If yes, write `pos-system-client/.interface-design/system.md`: direction and feel · depth strategy + spacing base · hierarchy decisions (type ratio, density, focal pattern) · component patterns used 2+ times with their measurements (e.g. `Button primary — 36px h · 12px 16px pad · 6px radius · 14px/500`). Then **hold to it**: spacing on grid, declared depth strategy, documented patterns reused not reinvented. Each save compounds.

---

*Adapted from the `interface-design` skill; tuned for this POS project (installed shadcn/Radix stack, keyboard-first sale flows, Spanish UI copy, Tailwind 4 + next-themes).*
