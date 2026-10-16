# OpsHub — What Is Left

## Immediate (verify the last change)
1. Run `npx tsc --noEmit` and `npm run lint` after the permissions fix in `apps/web/src/runtime/SiteRoutes.tsx`.
2. Re-run `npx playwright test` — the "core demo" spec (publish Return Management → rollback) must pass. The e2e leaves the dev DB at a later Distribution release; use `npm run demo:reset` to restore.
3. Re-run web unit tests (the `SiteRoute` change may affect mocks) and the API suites after adding `GET /trust/checks`, `GET /modules/data-types`, any-of permissions and the reserved-path rule (these backend additions were typechecked but the integration suite was **not re-run** afterwards).

## Documentation (required by the plan, none written yet)
- `README.md`, `CLAUDE.md`
- `docs/architecture.md`, `database.md`, `api-contract.md`, `configuration-schema.md`, `module-registry.md`, `security.md`, `demo-runbook.md`, `team-workflow.md` (four-person ownership)
- Must cover: RLS + how migrations/seeds work with it, token revocation / secret rotation, CSRF approach, release/rollback model, dev credentials (`*@opshub.local`, password `opshub-dev-1`, local only), embedded-Postgres fallback vs Docker.
- OpenAPI document consistent with the route manifest, plus a test comparing `manifest` to it.

## Delivery
- `.github/workflows/ci.yml`: install, lint, typecheck, unit tests, `config:validate`, build, DB integration tests (Postgres service via `TEST_DATABASE_ADMIN_URL`).
- Lightweight CI checks: no `eval`, no site-slug conditionals, no hardcoded secrets.
- Prettier pass (`npm run format`) — not yet run.
- Docker Compose path is **untested** (Docker daemon was not running); verify `docker compose up` + `db:migrate` + `db:seed`.
- Initial git commit (nothing has been committed).

## Backend features not built (currently honest 501 or absent)
- Return management service/endpoints (`return_records` table exists).
- PCB repair service/endpoints with `repairTransitions` enforcement (`repair_records` table exists).
- Analytics endpoints and server-side aggregation.
- Excel export with ExcelJS, formula-injection protection, site/permission scoping.
- User management endpoints (module is contract-only).
- AI provider interface + labelled mock provider (patch must go through the same compiler; never auto-publish).
- Idempotency for other mutations, stock adjustments / receipts endpoint.
- Secret-rotation support (multiple JWT keys), periodic cleanup of idempotency keys.

## Test gaps called out in the plan
- API: request-level inventory transaction rollback via HTTP, tenant isolation per remaining operational table via the API.
- Frontend: site-switching and publish-state handling unit tests (covered partly by e2e only).
- Playwright: logged-in coverage for Service Centre kanban and Excel/analytics pages once built.
- Trust Console: CI/build status integration (currently reported as "Not run").

## Known gaps / risks
- Frontend bundle is ~950 kB (no code splitting).
- Builder: position-drag updates clone the whole config per event; no undo/redo; page/role/workflow editing is limited to automatic changes when adding/removing modules.
- Admin role permissions are explicit lists in seed configs; modules added later grant permissions to role `admin` only.
- `users` table is readable (including `password_hash`) by the app role for login; documented tradeoff, a SECURITY DEFINER login function would be tighter.
- `embedded-postgres` is a dev/test fallback only and was the only PostgreSQL used in all runs so far.

## Suggested next three tasks
1. Verify and commit the current state (typecheck, lint, all suites, Playwright), then write README + docs + CI.
2. Implement returns and PCB repair services with transitions, ledger entries (return-restock) and tests.
3. Excel reports + analytics endpoints, then the AI provider boundary.
