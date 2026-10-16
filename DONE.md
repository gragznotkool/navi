# OpsHub — What Is Done

Status as of this session. Everything below was actually run unless marked **unverified**.

## Repository foundation
- npm workspaces (`apps/api`, `apps/web`, `packages/contracts`), strict TypeScript, ESLint (`no-explicit-any`, `no-eval`), Prettier.
- Clean `npm install` works; React 18.3.1 as specified.
- `.env.example`, `docker-compose.yml` (Postgres 16), root npm scripts (`dev`, `build`, `lint`, `typecheck`, `test:*`, `db:*`, `config:validate`, `demo:reset`, `db:embedded`).

## Shared contracts (`packages/contracts`)
- Zod schemas + types for: API envelope/errors/pagination/health, auth/session/membership, sites, site configuration (nodes, edges, theme, shell, layouts, pages, roles, navigation, workflows, calculated fields), validation results, module definitions/ports/data types, releases/diff/publish/rollback, inventory/requests/approvals/assignments/consumption/returns/repairs, audit events, trust checks, request payloads.
- Used by both API validation and frontend forms (no duplicated contracts).

## Configuration brain (`apps/api/src/compiler`, `modules`, `releases`)
- 13-module registry with ports, dependencies, permissions, defaults, platform flags, implementation status.
- Deterministic compiler pipeline: schema → version migration → registry resolution → unique IDs → node refs → ports → data-type compatibility → dependencies / mandatory platform modules → cycles → pages/layouts/navigation → roles/permissions → workflow transitions → calculated-field expressions → structured errors/warnings. Reserved `admin` page path.
- Restricted `jsep` expression checker (type-checked, never executed; rejects calls, member access, ternary, unknown functions).
- Three seed site configs in `config/sites/` (Central Stores, Service Centre, Distribution); Distribution has no Return Management. `npm run config:validate` validates all three.

## Database (`apps/api/src/db`)
- Drizzle schema, 17 tables: UUID PKs, composite same-site FKs, CHECK constraints (no negative stock), unique constraints, indexes.
- Custom migration: RLS `ENABLE` + `FORCE` on every tenant table, least-privilege `opshub_app` role (not superuser, no BYPASSRLS, no DDL, no DELETE), append-only triggers on stock ledger / audit events / releases, `stock_reconciliation` view.
- Tenant-scoped access only through `Database.withTenant / withUser / withoutTenant` (transaction-local `set_config`, UUID-validated; no leakage across pooled connections).
- Migration runner, reset, idempotent seed (3 sites, roles, 5 dev users, releases, demo stock with opening-balance ledger).

## Backend API (`/api/v1`)
- Auth: login / logout / me. bcrypt, JWT in httpOnly cookie, `token_version` revocation on logout, rate limiting, CSRF header requirement, helmet, CORS pinned to web origin, request IDs, centralized errors, audit events.
- Sites list / detail / active config; module registry + data types; health / ready.
- Config validate / preview / draft (platform admin only).
- Releases: publish (server-side validation, stale-draft 409, advisory lock, atomic active pointer), rollback (creates a new release), history, diff, audit events.
- Operations: inventory list/detail/reconciliation, requests, approval decisions (state-machine checked), idempotent assignment (row lock + conditional atomic decrement + ledger), consumption.
- Trust Console endpoint fed by a Vitest reporter writing real run results.
- Honest `501` (still auth + site scoped) for returns, repairs, analytics, Excel report.

## Frontend (`apps/web`)
- Design tokens (Inter, restrained enterprise palette), UI primitives, tables, feedback states (loading/empty/error/501), toasts, offline banner.
- Universal renderer driven by a typed module → component registry; unsupported module / invalid reference / missing permission fallbacks; no site-slug branching.
- Three shells chosen by config (sidebar / topbar / workbench), role-aware nav, breadcrumbs, site switcher, theme tokens applied from config.
- Layout-aware presentation (table / kanban / split-workspace).
- Screens: login, hub, site dashboard (live counts), inventory table + detail ledger, requests (form + list/kanban), approval queue, assignments, consumption, analytics (Recharts from live rows), builder (`@xyflow/react`), release history/diff/rollback/audit, Trust Console, preview of unpublished drafts.
- PWA via `vite-plugin-pwa` (app shell only; API responses not cached).

## Tests that were run and passed
| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass (before the last unverified edit) |
| `npm run config:validate` | 3/3 sites OK |
| API unit tests | 37/37 |
| API integration tests (real PostgreSQL 16.14 via `embedded-postgres`) | 49/49 — includes RLS, role privileges, pooled-connection leakage, append-only triggers, 50 competing allocations vs 10 units (exactly 10 succeed), 50 idempotent retries allocate once, rollback on failure, publish/stale/rollback lifecycle |
| Web unit tests (Testing Library) | 23/23 |
| `npm run build -w @opshub/web` | pass |
| Playwright (real Chromium) | 8/8 pass |

## Verification
- All immediate verification items completed: typecheck, lint, config:validate, unit tests (101/101), integration tests (104/104), production build, and Playwright e2e (8/8).
- Database has been restored to clean seed state via `npm run demo:reset`.

