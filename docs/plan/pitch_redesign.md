# OpsHub PS Upgrade — Workstream Plan

**Goal:** rebuild the pitch so an investor funds it for business, and the judges see a governed, explainable LangGraph automation system instead of a black box.

**Current state (verified 2026-10-17):** the `gargi` branch is at commit `b28c3ac` and already contains 6 LangGraph-based agents (`backend/core/agents/*.py`) plus 257 `decision_trace` records in SQLite. Two real gaps: (a) nothing makes Electrolyte Solutions' business case the story, (b) traces are raw SQL, not a visible reasoning surface.

**Key finding — sponsor site is empty.** `https://www.electrolytesoln.com/` serves only a heading; no wayback snapshot exists. All figures below marked `[HYPOTHETICAL]` must be replaced with Electrolyte's real numbers before any external use.

---

## Phase 0 — Numbers hygiene (do this first, ~1 day)

1. Delete the fabricated "20,000 technicians" from the deck and repo. It is stated in `index.html` (line 644), `OpsHub-Technical-Specification.md` and `docs/solution.md`, but no code supports it and it contradicts the repo's own `650+` figure.
2. Replace every invented metric with one of two labels: `DEMO` (measured in this repo) or `[HYPOTHETICAL]` (assumption awaiting sponsor data).
3. Add a one-page **data ledger** (`docs/business/data_ledger.md`) mapping each deck number to: source file + line, or "hypothetical".
4. Replace the "1,847 active technicians" mock with the real 650 (from `demo_data.json`) or Electrolyte's true fleet size.

---

## Phase 1 — Business perspective: Electrolyte Solutions as the anchor

### Deliverable 1A — Value-chain teardown (`docs/business/electrolyte_value_chain.md`)

Model the business Electrolyte actually runs, in the words of the user's own brief:

| Chain step | Current state | Cost driver | OpsHub intervention |
|---|---|---|---|
| Customer complaint intake | phone/WhatsApp/manual | lost calls, no priority logic | `intake_agent` → `triage_agent` |
| Route to technician | dispatcher judgment | slow assignment, wrong skill match | `dispatch_agent` |
| Parts procurement | manual stock check | stockouts, repeat trips | `parts_agent` + `inventory_agent` |
| On-site execution | paper/phone status | invisible until done | `execution_agent` + `sla_watcher` |
| Warranty & returns | manual ledger | disputes, revenue leakage | SLA countdown + `sla_compliance` |
| Reporting | month-end spreadsheets | late decisions | live dashboard |

Deliverable: for each row, name the process being eased and quantify before/after as `DEMO` or `[HYPOTHETICAL]`.

### Deliverable 1B — Odoo positioning (one page, `docs/business/odoo_positioning.md`)

Framing to use: **OpsHub does not replace Odoo, it governs the decisions Odoo cannot make.** Odoo's strength is transactional record-keeping (orders, stock, invoices) at ₹199–599/user/mo and ~77k installs. Its weakness is that judgement calls — priority, routing, part selection under stockouts, SLA breach prediction — are still a human's, and are invisible.

Three claims, each defensible in a Q&A:
1. **Decision layer, not record layer.** Odoo stores that a ticket exists; OpsHub decides *which* ticket, *which* technician, *which* part, and records *why*.
2. **Explainable by default.** Every decision ships with a reason string and candidate ranking — auditable after a breach, which is the exact moment Odoo users have nothing.
3. **Composable, not a migration.** Wraps existing ERP data; no rip-and-replace, so Electrolyte's install is days not months.

### Deliverable 1C — Investor case (`docs/business/investor_case.md`)

Structure investors actually scan: problem → market → why now → wedge → business model → unit economics → traction → ask.

- **Wedge:** spare-parts service providers sit between ODMs (Atomberg class) and distributors. Their margin is trapped in dispatcher overhead and stockouts. OpsHub is sold as **% of labour value automated**, not per-seat software — that is the line that reads as venture-scale.
- **Unit economics table:** CAC, gross margin, payback months, ARR per customer — every cell marked `DEMO` or `[HYPOTHETICAL]`.
- **Ask:** state it plainly, and tie it to the milestones already phased in the repo (Phase 2/3/4 in `backend/README.md`).

### Deliverable 1D — Live financial projection (optional, `docs/business/unit_economics.html`)

Small interactive model: inputs = fleet size, avg labour cost, automation %. Outputs = annual saving, subscription price, payback. Lets the presenter change fleet size on stage.

---

## Phase 2 — Orchestration: make the LangGraph visible

The graph already exists. The job is to make the audience watch it move.

1. **Static graph export** — render `ops_graph.png` from the actual `StateGraph` edges, so the architecture slide shows the real topology rather than a redrawn approximation.
2. **Live graph viewer in the dashboard** — nodes light up as a run executes, edges animate on transition, and the current node name appears in the header. Wire to the existing decision traces.
3. **Orchestration logic table** (`docs/business/orchestration.md`): every edge with its condition — e.g. `triage_agent → parts_agent` when `severity == critical AND stock_confirmed == false`. This is what proves the system is designed, not prompted.
4. **Determinism story:** explain that the graph is a fixed, reviewed state machine; the LLM only fills nodes. This is the answer to "how is this reliable in production?"

---

## Phase 3 — Explainability (the mentor's core ask)

The raw material is already in `decision_trace`: `agent_name`, `decision`, `reasoning`, `input_summary`, `output_summary`, `model_used`, `tool_called`, `timestamp`.

1. **Explainability panel per decision** — for any completed run show: the input, the chosen decision, the `reasoning` string, the tools called, the model used, and the rejected candidates with why they lost. Rejected candidates must be logged — that is the difference between "here's an answer" and "here's why".
2. **Reasoning timeline** — chronological strip down a ticket, each node annotated, so a reviewer can replay a breach end to end.
3. **Export to PDF/CSV** for warranty disputes and SLA breach reviews — the artifact Electrolyte's finance team would actually keep.
4. **Confidence + confidence threshold** — surface a score per decision; low-confidence routes to a human. Demonstrates governance, which investors read as de-risked.

---

## Phase 4 — Constraints language

1. **YAML/policy schema** — business rules external to code: max ticket age by severity, skill-to-job matching, stockout escalation, technician capacity, geography radius, escalation-to-manager triggers.
2. **Enforcement point** — a constraint validator node in the graph that rejects or re-routes a decision violating a rule, and writes a trace row for the rejection.
3. **Audit log** of constraint violations over time — shows the system failing safely.
4. **Editor UX** — let a business owner change a rule without touching code. This is the strongest single demo moment for a non-technical judge.

---

## Phase 5 — Automation & evaluation

1. **Auto-execution tiering:** auto-run (low risk), human-in-the-loop (high risk), block (violates constraint). Show a run in each tier.
2. **Evaluation harness:** a scored run set proving decisions beat a baseline (e.g. random dispatch), with precision/recall per agent.
3. **Guardrails:** input validation, output schema enforcement, retry with fallback, and a documented fallback when the LLM is unavailable.
4. **Cost/latency ledger per run** — LLM cost per decision is the number ops teams ask about.

---

## Phase 6 — Deck rebuild (8–10 slides)

Order designed so the business case lands before any architecture:

1. Cover — product + one-line value proposition
2. Problem — the dispatcher bottleneck, quantified
3. Why it's expensive — cost-of-delay, stockouts, warranty leakage
4. Electrolyte wedge — the value chain teardown (Deliverable 1A)
5. Product — the six agents doing six jobs
6. How it works — **the real LangGraph with live node highlighting**
7. Explainability — one decision, fully opened up
8. Vs Odoo — decision layer vs record layer
9. Traction & unit economics — every number labelled
10. Roadmap + ask

Visual system stays the existing command-room aesthetic: black background, halftone dot grid, luminous yellow accents, monospace data.

---

## Priority order

If time is short, do in this order:
1. Phase 0 (numbers) — cheapest, and an invented metric is the fastest way to lose a pitch
2. Phase 1C (investor case) + Phase 1B (Odoo)
3. Phase 2 (live graph) + Phase 3 (explainability panel) — the mentor's two headline asks
4. Phase 4 (constraints) — best technical differentiator
5. Phase 6 (deck)
6. Phase 5 and 1D — only if the earlier items land cleanly
