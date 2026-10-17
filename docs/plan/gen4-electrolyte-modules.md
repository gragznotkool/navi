# Gen-4 build plan — Electrolyte Solutions module pack

**Status:** plan, unimplemented. Write this top to bottom; do one phase, verify it, then the next.

**Scope answer first.** The problem statement's drag-and-drop requirement ("Drag and drop to build out your system using the predefined modules") applies to **all 13 modules**. Only 4 of those 13 get real domain functionality this round. So the target is: **13 registered and placeable, 4 of them live.** A judge who drops `user-management` or `reports-excel` must get a working page with a distinct look; a judge who drops `component-cannibalization` must get a scan → harvest → inventory flow that actually books parts.

Two things in the current build contradict the requirement today, and both are Phase 1/2 below:

- There is **no drag-and-drop**. `BuilderPage` adds modules through a `<SelectField>` dropdown (`apps/web/src/features/builder/BuilderPage.tsx:306`). The canvas is React Flow, which only accepts nodes created in state.
- The builder's auto-generation is **generic**. `addModule` (`apps/web/src/features/builder/configOps.ts:11`) picks whichever layout happens to be registered first, and the theme is a two-colour site-level pair. Nothing about the module changes the layout, theme or colour scheme.

## 0. The one rule that keeps this shippable

The contract is frozen at 13 module types (`packages/contracts/src/modules/index.ts:3`) and the compiler is the single authority on validity (`apps/api/src/compiler/compile.ts`, 16 stages). Do **not** add 4 new module types. Adding enum values forces a schema migration, a new contract build, registry + renderer entries, and touches the frozen scope the problem statement calls a disqualification risk.

Instead, give each of the 4 modules a **renderer** and a **backend capability**, keyed by a node `configFields` flag. A `pcb-repair` node with `config: { variant: "rcfa" }` becomes the RCFA module. `configFields` is already validated per node (compile.ts stage 4, lines 80-92), so this is zero schema risk. The 13-module registry is unchanged; the demo story is "one pcb-repair module, three production variants".

| Module | Reuses node type | Distinguishing `configFields` |
|---|---|---|
| Component Cannibalization & Harvesting | `consumption-tracking` | `variant: "harvest"`, `refurbPolicy: "refurbished-stock"` |
| Root-Cause Failure Analysis Heatmap | `pcb-repair` | `variant: "rcfa"` |
| ZED Sustainability & E-Waste Tracker | `return-management` | `variant: "ewaste"` |
| ESD & Multi-Stage QC Validator | `dashboard-shell` | `variant: "esd-qc"` |

If a judge asks why the registry shows 13 and not 17: the answer is the registry is the *predefined modules*, and production specialization is configuration. That is exactly what the platform is supposed to prove.

---

## Phase 1 — Real drag and drop (do this first; it is the demo's headline)

**Goal:** drag any of the 13 modules from a palette onto the canvas; a page appears in the sidebar with that module's layout and palette.

`BuilderPage.tsx` already has everything else: node rendering with typed ports (`ModuleNodeView`, line 24), typed connection checking with refusal reasons (`explainConnection`, `configOps.ts:82`), undo/redo, validate, draft, preview, publish. Only placement is missing.

Native HTML5 DnD, no new dependency:

- A palette column left of the canvas: 13 tiles, `draggable`, `onDragStart` sets `e.dataTransfer.setData("application/opshub-module", def.type)` plus `effectAllowed = "copy"`.
- The canvas wrapper `div` gets `onDragOver` (`preventDefault()` to allow drop) and `onDrop`. On drop, convert pointer to flow coordinates — this is the one function that is easy to get wrong:
  ```ts
  const pt = flow.current.screenToFlowPosition({
    x: ev.clientX - wrapRect.left,
    y: ev.clientY - wrapRect.top,
  });
  ```
- Feed the result into the existing `addSelected()` path (line 182): `addModule(config, def, pt)` → `edit(next)` → re-run `isolationProblem` so a freshly dropped module with unsatisfied dependencies shakes and explains itself immediately.
- Drop target affordance: highlight the canvas border while `dragOver`, and show a ghost tile at the cursor position.
- Keep the `<SelectField>` dropdown as the non-drag fallback. Judges with mice that behave badly, or accessibility.

**Done when:** dragging `pcb-repair` from the palette places a node at the cursor; the sidebar shows a new nav entry within the same interaction; undo removes both.

---

## Phase 2 — Per-module layout and palette

**Goal:** dropping a module creates a feature page whose layout and colours differ from its neighbours. This is explicitly graded: "Switching sites must change the layout, theme, modules and workflows, not just the colours."

Current shape: `pageDefinitionSchema` has `layoutId` only (`packages/contracts/src/config/index.ts:53`), `layoutDefinitionSchema` has `{id, type}` only (line 47), and `siteThemeSchema` is two site-wide hex colours (line 9). No per-module accent anywhere.

Extend the schema in place (bump `CURRENT_SCHEMA_VERSION` from 2 → 3, and add a `migrateConfiguration` step — the compiler already runs migration as stage 2, `compile.ts:58`):

```ts
layoutDefinitionSchema = z.object({ id, type, accent: hexColor.optional() });

pageDefinitionSchema = z.object({
  id, title, path, nodeId,
  layoutId,
  accent: hexColor.optional(),      // per-module colour, falls back to site theme
  ...(requiredPermission.optional()),
});
```

Then two mapping tables. These live next to the renderer registry (`apps/web/src/runtime/registry/index.tsx`) so the "only place a module type maps to UI" invariant from that file's comment stays true:

```ts
const MODULE_PRESENTATION: Record<ModuleType, { layout: LayoutType; accent: string }> = {
  inventory:               { layout: "data-table",       accent: "#FFE500" },
  "component-cannibalization": { layout: "split-workspace", accent: "#3DDC84" },
  rcfa:                    { layout: "dashboard",        accent: "#FF6B6B" },
  "zed-ewaste":            { layout: "dashboard",        accent: "#22A34A" },
  "esd-qc":                { layout: "split-workspace",  accent: "#38BDF8" },
  ...
};
```

`addModule` (`configOps.ts:18`) currently does `next.layouts.find(l => l.type === "data-table") ?? next.layouts[0]` — replace that lookup with `MODULE_PRESENTATION[def.type]`, and push the layout/accent onto the page. `UniversalRenderer.tsx` reads `page.accent` and sets a CSS custom property on the rendered module's root, so the existing `border-[#303432]` / `text-[#FFE500]` hardcodes become `var(--module-accent, #FFE500)`.

**The four modules get deliberately different shapes** — this is what makes the demo visible without any narration:

| Module | Layout | Palette | Why this shape |
|---|---|---|---|
| Cannibalization / Harvesting | `split-workspace` | green `#3DDC84` | Scan board on the left, harvest table and inventory preview on the right. Two-pane is the job. |
| RCFA Heatmap | `dashboard` | red `#FF6B6B` | Mostly visualization: virtual PCB, aggregated failure bars. |
| ZED / E-Waste | `dashboard` | eco green `#22A34A` | Manifests and diverted-weight gauges; compliance colour, on purpose. |
| ESD & Multi-Stage QC | `split-workspace` | cyan `#38BDF8` | Checklist + sign-off on the left, stage ladder on the right. Gates must be glanced at. |

**Done when:** dropping two modules produces two pages with different layout containers and different accent colours, and the compiled config still validates.

---

## Phase 3 — The backend seam (build this before Phases 4-7)

Each of the 4 modules needs a table, repository, service, route, contract type and UI. That is a repeatable shape; define it once.

**`apps/api/src/db/schema/index.ts`** — add `site_id` + `userId` on every table, use the existing `tx`/`Database` transaction type from `db/scoped.ts`, and add each table to whatever RLS list exists in `db/`. The existing tables (`approvals`, `assignments`, `consumption_records`, `stock_ledger`, `returns`, `repair_records`, `site_config_releases`, `site_active_releases`, `audit_events`) show the exact pattern to copy, including `serialiseInsert` for optimistic concurrency and unique constraints that make writes idempotent.

Two constraints already in the DB must be respected, because they will bite:

- `stock_ledger_ref_reason_uq` UNIQUE(`ref_type`,`ref_id`,`reason`) (`db/schema/index.ts:217`) — one ledger row per reference per reason. Harvest must emit one ledger entry per harvested component, keyed by the component row id, so a retry never double-books.
- `ledger_reason` is a **pg enum** (`db/schema/index.ts:41`: `opening-balance | assignment | return-restock | adjustment`). Harvesting needs a new value, so Phase 3 adds a migration that extends the enum. Every `INSERT` into `stock_ledger` type-checks against it, which is why the enum must change in the same migration as the new tables.

**Route wiring** goes in `apps/api/src/app.ts` alongside the existing `/sites/:siteId/...` router (`st = ...`), so `auth` and `requireSite(db, permission)` wrap it the same way. New permissions like `harvest:record` and `esd:signoff` must be added to the registry's `permissions` array or the compiler's stage 12 will reject the configuration for granting a permission no module defines.

**Migrations:** generate with `npm run db:generate`, apply with `npm run db:migrate`. There is an embedded DB path (`npm run db:embedded`) — the demo should use that so it runs anywhere, not just against a provisioned Postgres.

---

## Phase 4 — Component Cannibalization & Harvesting Engine

**Purpose in the demo:** scan a dead board, extract components, watch them land in Inventory as Refurbished Stock, watch the savings number move.

Data:
- `harvest_boms(id, site_id, source_unit_id, source_unit_label, oem, product_model, board_serial, scan_ref, status enum[scanned, in-progress, completed, voided], scanned_by, scanned_at, completed_at)`
- `harvest_components(id, bom_id, site_id, component_id nullable, part_number, component_type enum[mc u, relay, capacitor, resistor, bga, fine-pitch-ic, mosfet, transformer, other], package, quantity, condition enum[excellent, good, marginal, failed], extracted_at, extracted_by, inventory_item_id nullable)`
- Inventory needs a stock class: `new | refurbished | harvested`, plus `original_cost` and `harvested_cost` so the value of a salvaged part is derivable instead of asserted.

Flow:
1. Scan: POST the dead unit. If a scan reference already exists and is completed, return the existing BOM — idempotent.
2. Harvest components: each POST validates against a small built-in parts catalogue (`component_type` × typical package × typical new-cost). Unknown parts get a conservative zero-cost default and an `unverified` flag. Do not let the form accept a free-text price for a harvested component. That is where the metric becomes unauditable.
3. Book to inventory: within one transaction, insert `inventory_items` (class `refurbished`, `harvested_cost`, `refurbished_from_bom_id`) and insert `stock_ledger` with the new enum value. One ledger row per component, so the unique constraint enforces idempotency.
4. Savings: `SUM(new_cost - harvested_cost)` over harvested components, minus an explicit `refurb_handling_cost` per component. **Show both the gross and the netted figure.** A savings number with no handling cost in it is the first thing a finance person will attack.

UI (`split-workspace`, green): board scan panel → harvest table with condition chips → live inventory preview that pulses when a component lands → running gross/net savings readout.

---

## Phase 5 — Root-Cause Failure Analysis (RCFA) Heatmap

**Purpose in the demo:** tag failures on a virtual board, then show the manufacturer that 40% of a model's failures trace to one component class. This is the OEM feedback loop — the thing Electrolyte sells to Bajaj/Atomberg.

Data:
- `rcfa_failures(id, repair_record_id nullable, site_id, oem, product_model, unit_serial, component_type, placement_ref, failure_mode enum[short, open, thermal, corrosion, mechanical, esd, unknown], root_cause enum[component-defect, pcb-defect, assembly-defect, design-margin, environmental, unknown], reliability_score number, noted_by, noted_at)`

The virtual PCB is an SVG, not an image. Render the board outline and a grid of placements as SVG `<rect>`/`<circle>` elements sized by failure count and filled by `failure_mode`. Clicking a placement drills into the failure rows. This has to be SVG because it must be inspectable and keyboard-reachable, and because a judge will try to hover over something.

Aggregation is the whole point — group by `(oem, product_model, component_type)`, roll up to percentage of that model's failures, sort descending. The headline row is what the demo stops on.

UI (`dashboard`, red): virtual PCB at top, failing placements glowing proportionally; failure-mode bars per model below; a plain-English sentence per model ("40% of Bajaj IH-3200 failures trace to C17 electrolytic capacitors, 470uF, thermal"). That sentence is generated from the aggregation, not hand-written.

---

## Phase 6 — ZED Sustainability & E-Waste Tracker

**Purpose in the demo:** a board nobody can fix becomes a certified e-waste transfer manifest, and the dashboard shows how much landfilled e-waste was diverted by repairing instead of replacing.

Data:
- `ewaste_manifests(id, site_id, manifest_number, certificate_ref, certificate_type enum[zed-bronze, zed-silver, zed-gold], total_weight_g, unit_count, disposal_entity, transport_id, chain_of_custody jsonb, signed_by, signed_at, status enum[draft, signed, shipped, accepted, closed])`
- `ewaste_items(id, manifest_id, site_id, unit_serial, oem, product_model, reason enum[unrepairable, board-defect, economic-loss, obsolete])`
- `sustainability_metrics(id, site_id, period_start, period_end, units_repaired, units_replaced, co2e_kg_saved, waste_g_diverted)`

`manifest_number` is generated server-side and unique per site. The number appears on the manifest and in the chain of custody — the demo needs a document a judge can point at, not just a dashboard tile.

The carbon figure must be a formula, not a constant, or it collapses under a question. `co2e_kg_saved = units_repaired × emission_factor_per_replacement_kg`, with `emission_factor_per_replacement_kg` held as a named, visible parameter (config value, editable, default disclosed on screen). Same for the fan-versus-cooktop split: the factor differs by product class. Saying the number comes from a disclosed, editable factor is a defensible engineering answer. Saying it comes from domain knowledge is not.

UI (`dashboard`, eco green): manifest list with sign-off state, chain-of-custody timeline, diverted-weight gauge, CO₂e saved with the emission factor visible next to the number.

---

## Phase 7 — ESD & Multi-Stage QC Validator

**Purpose in the demo:** a repair cannot move forward until the ESD grounding check and the stage gates are signed off. It is the cheapest of the four to build and the most credible to an ISO 9001:2015 auditor, so it is a good second phase even after 1.

Data:
- `qc_signoffs(id, site_id, target_type enum[repair, assignment, return, bom], target_id, stage enum[incoming, in-process, outgoing, esd-check], esd_station_id, grounded_at, grounded_by, inspection_result enum[pass, conditional, fail], notes, signed_at)`
- Unique on `(target_type, target_id, stage)` — a stage has exactly one sign-off, so the workflow cannot silently pass a gate twice or skip it.

Enforcement is the module. The QC stage is **not** a UI hint: the existing status-transition endpoints (`PATCH /sites/:siteId/repairs/:id/status`, and the same pattern for returns and assignments) must reject the transition with 409 when the preceding stage has no signed sign-off. That is what makes it a validator instead of a checkbox, and it is what the audit trail needs.

UI (`split-workspace`, cyan): ESD grounding checklist with station selection and digital sign-off on the left; the stage ladder Incoming → In-Process → Outgoing on the right, each gate showing signed-by and signed-at, and the next gate visually locked until its predecessor closes.

---

## Phase 8 — Explainability and the orchestration trace (mentor requirement)

**This is unbuilt.** `apps/api/src/compiler/trace.ts` does not exist — `BuilderPage` imports it at line 14 and `compileConfiguration` at `compile.ts:56` has no trace parameter or trace emission. The audit path is generic: `recordAudit` (`apps/api/src/audit/audit.ts`), exposed at `/sites/:siteId/audit-events` (`app.ts:375`) and `/trust/audit-events` (`app.ts:224`).

What is needed: every automated decision writes a structured record — inputs, rules that fired, the action taken, a human-readable reason, confidence, and who may override it. Concretely: a `decision_records` table, RLS-scoped like everything else, plus a `/sites/:siteId/decisions` route and a "Why" panel in each module's UI.

Two constraints on scope:

- The 4 modules' gates are **deterministic**. The harvest booking, the RCFA aggregation, the manifest generation and the QC rejection are rule-driven and need no LLM. Do not add a model there. Explainability for a deterministic rule is free and exact.
- LangGraph/LangChain earns its place at one layer: routing a repair to repair-versus-replace, using the RCFA history as the signal. The LLM proposes, the rules dispose, and the proposal lands in `decision_records` with its reason. That is a defensible use, and it is visible in the trace. Claiming the whole platform is orchestrated by LangGraph would be a claim this build cannot support.

---

## Phase 9 — Business case and pitch (sponsor and investor framing)

The 4 modules are the reason Electrolyte buys this. The pitch needs to say so in their own terms:

- **Harvesting** turns dead stock into margin. The cost of a harvested MCU is the handling, not the purchase.
- **RCFA** is a paid service to the OEM. Electrolyte earns by telling Atomberg and Bajaj *why* their products fail — that is R&D feedback they cannot get from their own sales data, and it is the strongest retention lever in the deck.
- **ZED** is compliance insurance. ZED Bronze is held; the tracker is what keeps it, and it is presentable to an auditor.
- **ESD/QC** is audit readiness for ISO 9001:2015 at a facility that has to defend it.

Against Odoo: it is a serious ERP and the right ledger. It does not model after-sales cannibalization, RCFA by OEM, or ZED compliance. The pitch position is a layer on top, synced, not a replacement.

The investor ask maps to what is already proven: multi-tenant by construction, decisions logged and reversible, isolation enforced by the database. The defensible asset is the decision log — every operational call becomes data a competitor cannot buy.

---

## Build order

| # | Phase | Why this order |
|---|---|---|
| 1 | Drag and drop | The headline interaction; the requirement says drag and drop |
| 2 | Per-module layout and palette | Makes every drop visibly different; cheap, sits on the schema |
| 3 | Backend seam (tables, migrations, route pattern, enum) | Unblocks 4-7; the enum migration must land early |
| 4 | ESD & Multi-Stage QC | Smallest surface, enforcement is a 409 on an existing endpoint, huge audit credibility |
| 5 | Cannibalization & Harvesting | Highest business value; needs the ledger enum from Phase 3 |
| 6 | RCFA Heatmap | Needs a repair record to hang off; the OEM story |
| 7 | ZED & E-Waste | Manifest + metrics; depends on returns |
| 8 | Explainability and decision records | Layer over 4-7 |
| 9 | Business case and pitch | Written, not built |

## Demo script (4-5 minutes)

1. Drag `component-cannibalization` onto the canvas. It lands with a green split-workspace page in the sidebar. Drop `rcfa` next to it; red dashboard, different shape. This is the platform claim, in 20 seconds.
2. Publish. The new module appears with no code change and no restart.
3. Scan a dead board, extract three components, watch them book into Inventory as Refurbished Stock and the savings counter move.
4. Tag failures on the virtual PCB. Read the headline: 40% of one model traces to one capacitor.
5. Route an unrepairable board to an e-waste manifest. Show the manifest number, chain of custody, and the diverted weight.
6. Try to advance a repair past Incoming QC without signing the ESD check. It is rejected. Sign it. It advances.
7. Open the decision record for step 3: inputs, rules fired, action, reason, who can override.

## Risks

- **Scope.** 4 modules × (table, migration, repository, service, route, contract, UI) is the whole budget. If time fails, do Phases 1-2 and 4 fully and land 5 as a stub with live ledger booking — a stub with the inventory line visible beats a half-wired module.
- **Schema version bump.** Version 2 → 3 requires `migrateConfiguration` to handle old stored releases. The compiler's stage 2 already runs migration, so this is one function, but forgetting it breaks every existing seeded site.
- **The ledger enum.** `ledger_reason` is a pg enum, not text. A new value needs a migration before any harvest insert, and every insert type-checks against it.
- **Cost inputs.** Any per-component cost a human types is unauditable. Harvested costs come from the built-in catalogue with a disclosed default; anything else is flagged `unverified`.
- **Emission factors.** Keep them visible parameters next to the numbers they produce. A hidden constant does not survive a finance question.
