# OpsHub

A configuration-driven operations platform. Each site (Central Stores, Service Centre, Distribution, or one you create) runs the **same** application; what differs is its published configuration: modules, pages, roles, fields, theme and deadlines. Configuration is versioned, validated by a compiler, published as an immutable release, and can be rolled back without losing history.

## Quick start

```bash
cp .env.example .env            # edit JWT_SECRET (32+ random characters)
npm install
npm run db:embedded &           # a throwaway local PostgreSQL on :5432 (or use your own PostgreSQL)
npm run db:migrate && npm run db:seed
npm run dev                     # API on :4000, web on :5173
```

Sign in at http://localhost:5173 with `admin@opshub.local` / `opshub-dev-1` (other seeded accounts: `storekeeper@`, `technician@`, `approver@`, `dispatcher@`; local development only).

Everything you must configure yourself is in [userconfig.md](userconfig.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web with reload |
| `npm run lint` / `typecheck` / `build` | static checks and production build |
| `npm run test:unit` | contracts, API unit and web component tests |
| `npm run test:integration` | API against a real PostgreSQL (RLS, locking, idempotency) |
| `npm run test:e2e` | Playwright in Chromium (needs the dev servers; see below) |
| `npm run guard` / `test:guards` | repository rules: no site-slug branching, no `eval`, no committed secrets |
| `npm run config:validate` | compile the three seed site configurations |
| `npm run demo:reset` | **destroys** the dev database, migrates and reseeds |

Playwright publishes and rolls back releases on the seeded sites. If a run stops half-way, roll the site back to version 1 in the Releases page or run `npm run demo:reset`.

## What is in it

- **Sites and configuration:** builder (graph of modules), fields, roles, plain-English change summaries, impact preview, destructive-change confirmation, releases, rollback and the Rewind slider. New sites are provisioned in one save with a live log.
- **Operations:** inventory with an append-only stock ledger, multi-line requests, approvals with a live SLA ring, atomic stock allocation, consumption, returns, PCB repair, manual stock adjustment, analytics, Excel export/import, user management.
- **Bolo & Build:** say or type a change in English, Hindi or Marathi; a model (Gemini or Anthropic) or built-in demo phrases propose a patch which is validated by the compiler and applied to the draft only. It never publishes.
- **Offline:** requests and consumption entered offline are saved on the device and replayed exactly once; stock-changing actions are blocked offline by design.
- **Public intake:** an optional signed-out request form per site, enabled by configuration.
- **Trust Console:** live proofs of tenant isolation, role privileges and concurrency, run against a reserved lab site.

## Documentation

[docs/architecture.md](docs/architecture.md) · [docs/database.md](docs/database.md) · [docs/security.md](docs/security.md) · [docs/configuration-schema.md](docs/configuration-schema.md) · [docs/module-registry.md](docs/module-registry.md) · [docs/api-contract.md](docs/api-contract.md) (and `GET /api/v1/openapi.json`) · [docs/demo-runbook.md](docs/demo-runbook.md) · [docs/team-workflow.md](docs/team-workflow.md)
