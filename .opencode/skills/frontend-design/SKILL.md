---
name: frontend-design
description: Guidance for distinctive, intentional UI design in this POS system — screens, dashboards, and flows that don't read as a templated shadcn admin. Trigger: building new UI, redesigning a screen, or making visual/UX decisions.
---

# Frontend Design

Approach this as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. The enemy here is not the generic landing page — it is the **default shadcn admin template** look that every AI-built back-office app has. Make deliberate, opinionated choices that are specific to this product, and take one real aesthetic risk you can justify.

## Context: what we are designing

- A multi-tenant POS system: checkout/sale flow, dashboard with charts, catalog management (data tables + sheets), auth screens. Not marketing pages.
- Users are cashiers and admins **under time pressure**. A POS screen's job is to minimize seconds and mistakes per operation — distinctiveness never costs speed or legibility.
- Established design system — extend it with intention, do not fight it: Tailwind 4 + shadcn + `@tabler/icons-react` (never lucide) + next-themes (dark/light) + recharts + sonner.
- **UI copy in Spanish**, sentence case; code and identifiers in English.

## Where distinctiveness lives in an app

Not in heroes. In: type scale and numeric legibility (money and quantities use tabular figures), density choices, the interaction rhythm of the sale flow, disciplined empty/error states, and one signature element (e.g. the cart panel behavior or the checkout confirmation moment) that embodies the product.

## Design principles

- **Ground it in the subject's world.** Retail: tickets and receipts, barcode scanners, cash drawers, thermal printers, speed. The vernacular of retail is where distinctive choices come from — not from Dribbble.
- **Typography carries the personality.** Pair display/body faces deliberately (not the families you'd reach for on any project), with a utility face or tabular treatment for data. Make the type treatment itself memorable, not a neutral delivery vehicle.
- **Structure is information.** Numbering, eyebrows, dividers, and labels must encode something true about the content. Numbered markers (01/02/03) only if the content actually is a sequence. Question decorative structure before adding it.
- **Motion is deliberate and never delays the next sale.** One orchestrated moment lands harder than scattered effects; flow interactions stay fast (~200ms). Respect reduced motion. Excess animation reads as AI-generated.
- **Match complexity to the vision.** Maximalist directions need elaborate execution; minimal directions need precision in spacing, type, and detail. Elegance is executing the chosen vision well.
- **Dashboards: the chart answers the user's question.** Choose the chart that serves the decision, not the default. See `pos-system-client/.claude/RECHARTS_CHARTS_TROUBLESHOOTING.md` (horizontal bars need `layout="vertical"`).

## Process: brainstorm, critique, build, critique again

Work in two passes. First, a short design plan from the brief: a compact token system — **color** (4–6 named hex values), **type** (characterful display face used with restraint + complementary body face + utility face for captions/data), **layout** (one-sentence concept or ASCII wireframe), **signature** (the single element this screen will be remembered by).

Then critique the plan before building: if any part reads like what you'd produce for *any* admin app, revise it, and say what changed and why. AI-generated design clusters around three defaults — cream background + serif display + terracotta accent; near-black + single acid accent; broadsheet hairline columns. The brief's own words always win, but don't spend free axes on a default. Only then write code, following the plan exactly and deriving every color/type decision from it.

Implementation pitfalls: watch CSS selector specificity collisions (type-based vs element-based classes canceling each other, especially section padding/margins). Do the iteration in your thinking; show the user only high-confidence directions.

## Restraint and self-critique

Spend your boldness in one place: the signature element. Keep everything around it quiet and disciplined; cut any decoration that doesn't serve the brief. Not taking a risk is itself a risk. Build to a quality floor without announcing it: responsive down to mobile, visible keyboard focus (POS flows are keyboard-first — scanner input), both dark and light themes *designed*, not defaulted. Critique as you build; take screenshots if the environment supports it. Chanel's rule: before shipping, remove one accessory. If you have a place to jot what you tried, note it for future passes.

## Writing in design (UI copy)

Words exist to make the product easier to use — design material, not decoration. Bring the same intentionality to copy as to spacing and color.

- **Write from the user's side of the screen.** Name things by what people control and recognize, never by how the system is built. Plain terms over clever ones; specific over vague.
- **Active voice.** A control says exactly what happens: "Guardar cambios", not "Enviar". An action keeps one name through the flow: the button that says "Publicar" produces a toast that says "Publicado".
- **Failure and emptiness are moments for direction, not mood.** Errors don't apologize and are never vague about what happened or how to fix it. An empty screen is an invitation to act.
- **Register:** Spanish, conversational, sentence case, no filler. Each element does exactly one job — a label labels, an example demonstrates.

---

*Adapted from the `frontend-design` skill; tuned for this POS project (app screens, established Tailwind/shadcn system, Spanish UI copy).*
