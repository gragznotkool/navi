# OPSHUB — MASTER ENGINEERING PROMPT FOR GENESIS 2.0 HACKATHON

## 1. YOUR ROLE AND MISSION

Act as a senior software architect, principal full-stack engineer, database designer, application security engineer, and enterprise UI/UX engineer.

Build the foundational repository for **OpsHub**, a configuration-driven, multi-site industrial operations platform for the Genesis 2.0 hackathon, PS-03.

The project has 500+ competing teams. Our objective is to establish a technically credible, professionally designed, demonstrable, and extensible foundation that four developers can work on simultaneously.

You are working directly inside the repository using Claude Code. You must inspect the existing repository, create and edit actual files, install dependencies where possible, run checks, fix errors, and report the real outcome.

**Do not respond with an architecture proposal instead of implementation. Build the repository.**

The quality bar is production-minded engineering, not a production-readiness claim. Prioritize a smaller, correct, runnable foundation over a large collection of generated boilerplate.

## 2. THE CORE PRODUCT IDEA

OpsHub is a configuration-driven operations platform.

One shared application and runtime must support different businesses or sites with their own:

- Branding and themes.
- Navigation and application shell.
- Enabled modules.
- Page layouts.
- Fields and forms.
- Tables and dashboards.
- Roles and permissions.
- Workflows and approval rules.
- Operational records and analytics.
- Published configuration versions.

A platform administrator should eventually be able to modify a site's configuration through a visual builder, validate it, preview the result, and publish it without restarting the application or deploying a new frontend.

A published configuration determines how the platform behaves. The implementation must not contain business-specific conditional branches for individual demo sites.

**Forbidden pattern:**

`if (siteSlug === "central-stores") ...`

**Required pattern:** a validated site configuration selects registered modules, layouts, navigation, theme tokens, fields, permissions, and workflows. The common runtime renders them.

Shared platform capabilities may have platform-level rules, but site identity must not be used as a shortcut for business-specific logic.

## 3. THREE REQUIRED DEMO SITES

Create three validated seed configurations in `config/sites/`.

### A. Central Stores

- Slug: `central-stores`
- Theme: teal, using `#0F766E` as its primary accent.
- Shell: sidebar.
- Layout: dashboard and data-table layouts.
- Modules:
  - Authentication and RBAC.
  - User Management.
  - Inventory.
  - Dashboard Shell, Navigation and Forms.
  - Analytics Dashboard.
  - Reports with Excel.

The experience should prioritize inventory visibility, stock levels, transactions, reports, and operational summaries.

### B. Service Centre

- Slug: `service-centre`
- Theme: blue and orange.
- Primary accent: `#1D4ED8`.
- Shell: top navigation with cards where appropriate.
- Layouts: Kanban and table.
- Modules:
  - Authentication and RBAC.
  - User Management.
  - Dashboard Shell, Navigation and Forms.
  - Request.
  - Approval.
  - PCB Repair.
  - Return Management.
  - Analytics Dashboard.

The experience should prioritize service requests, approvals, repair status, returns, and technician workflows.

### C. Distribution

- Slug: `distribution`
- Theme: violet and cyan.
- Primary accent: `#6D28D9`.
- Shell: workbench.
- Layout: split workspace.
- Modules:
  - Authentication and RBAC.
  - User Management.
  - Dashboard Shell, Navigation and Forms.
  - Request.
  - Approval.
  - Material Assignment.
  - Assignment Frontend.
  - Consumption Tracking.
  - Analytics Dashboard.

Initially, Distribution must NOT include Return Management.

The demo must be able to demonstrate enabling Return Management through configuration editing and publishing a new release, after which the module appears through the common runtime.

Do not implement this demonstration as a special case for Distribution.

All three site configurations must pass the same validation pipeline.

## 4. NON-NEGOTIABLE ENGINEERING PRINCIPLES

1. Inspect the repository before making changes.
2. Preserve existing useful work; never overwrite files blindly.
3. Implement actual files, not merely file names or TODO comments.
4. Prefer maintainable, straightforward TypeScript.
5. Use strict TypeScript throughout.
6. Do not use `any` as a shortcut.
7. Do not suppress errors to achieve a passing build.
8. Never fabricate successful test results.
9. Never represent mocked results as live production data.
10. Every visible interactive control must have a defined behavior.
11. Every API endpoint must be implemented, explicitly unavailable, or documented.
12. Do not create duplicate contracts across frontend and backend.
13. Do not create unnecessary abstraction layers.
14. Do not use `eval` for configuration expressions.
15. Never trust frontend authorization or tenant selection alone.
16. Do not allow configuration publishing to bypass validation.
17. Never silently convert invalid configuration into valid configuration.
18. Use real database constraints and transactions for critical invariants.
19. Keep modules independently implementable by different team members.
20. Document incomplete functionality honestly.

Before creating an abstraction, ask whether it establishes a real boundary, enforces a rule, prevents duplication, or enables independent development.

## 5. FIXED TECHNOLOGY STACK

Use the following stack unless an existing repository constraint makes a change essential. If a deviation is necessary, explain it.

### Repository and language

- npm workspaces.
- TypeScript strict mode.
- ESLint.
- Prettier.
- Shared types and Zod schemas.

### Frontend

- React 18.
- Vite.
- TypeScript.
- Tailwind CSS.
- React Router.
- Zustand.
- Axios.
- `@xyflow/react` for the visual configuration builder.
- Recharts.
- React Hook Form.
- Zod.
- Lucide React.
- `vite-plugin-pwa`.

### Backend

- Node.js.
- Express.
- TypeScript.
- Zod.
- JWT authentication.
- bcrypt password hashing.
- Drizzle ORM.
- PostgreSQL 16.
- ExcelJS for Excel reports.

### Testing

- Vitest.
- Supertest.
- React Testing Library.
- Playwright.
- PostgreSQL-backed integration tests.

### Development and delivery

- Docker Compose.
- GitHub Actions.
- OpenAPI documentation.
- `.env.example`.
- Repeatable database migrations and seed scripts.

Use mutually compatible package versions. Generate a lockfile and ensure a clean dependency installation is possible.

## 6. REQUIRED MONOREPO STRUCTURE

Create a clean, meaningful structure similar to:

```text
opshub/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── ui/
│   │   │   │   ├── layout/
│   │   │   │   ├── forms/
│   │   │   │   ├── tables/
│   │   │   │   └── feedback/
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── hub/
│   │   │   │   ├── sites/
│   │   │   │   ├── builder/
│   │   │   │   ├── releases/
│   │   │   │   ├── inventory/
│   │   │   │   ├── requests/
│   │   │   │   ├── approvals/
│   │   │   │   ├── assignments/
│   │   │   │   ├── consumption/
│   │   │   │   ├── returns/
│   │   │   │   ├── pcb-repair/
│   │   │   │   ├── analytics/
│   │   │   │   ├── reports/
│   │   │   │   └── security-console/
│   │   │   ├── runtime/
│   │   │   │   ├── UniversalRenderer.tsx
│   │   │   │   ├── SiteShell.tsx
│   │   │   │   ├── layouts/
│   │   │   │   ├── pages/
│   │   │   │   ├── forms/
│   │   │   │   └── registry/
│   │   │   ├── services/
│   │   │   ├── stores/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   ├── public/
│   │   ├── tests/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── api/
│       ├── src/
│       │   ├── app.ts
│       │   ├── server.ts
│       │   ├── config/
│       │   ├── middleware/
│       │   ├── routes/
│       │   ├── controllers/
│       │   ├── services/
│       │   ├── repositories/
│       │   ├── db/
│       │   │   ├── schema/
│       │   │   ├── migrations/
│       │   │   ├── seeds/
│       │   │   ├── client.ts
│       │   │   └── scoped.ts
│       │   ├── modules/
│       │   ├── workflows/
│       │   ├── compiler/
│       │   ├── releases/
│       │   ├── security/
│       │   ├── audit/
│       │   ├── jobs/
│       │   └── utils/
│       ├── tests/
│       └── package.json
├── packages/
│   └── contracts/
│       ├── src/
│       │   ├── common/
│       │   ├── auth/
│       │   ├── sites/
│       │   ├── config/
│       │   ├── modules/
│       │   ├── releases/
│       │   ├── inventory/
│       │   ├── workflows/
│       │   ├── analytics/
│       │   └── api/
│       └── package.json
├── config/
│   ├── sites/
│   │   ├── central-stores.json
│   │   ├── service-centre.json
│   │   └── distribution.json
│   └── presets/
├── docs/
├── scripts/
├── .github/workflows/ci.yml
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .prettierrc.json
├── eslint.config.js
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── README.md
└── CLAUDE.md
```

Adjust filenames only when there is a clear engineering reason. Do not create empty files solely to match the tree.

## 7. FRONTEND QUALITY — THIS IS A CRITICAL REQUIREMENT

The frontend must NOT look like generic AI-generated SaaS boilerplate.

Design OpsHub as a serious industrial operations product used by inventory managers, approvers, storekeepers, technicians, and administrators.

### Avoid

- Excessive gradients or glassmorphism.
- Decorative floating shapes.
- Glowing borders and gratuitous animation.
- Huge hero sections in the authenticated application.
- Emoji navigation.
- Random metric cards with invented numbers.
- Nested cards for every piece of information.
- Overuse of rounded containers.
- Repeated cards when a table is the correct presentation.
- Fake charts or fabricated operational statistics.
- Oversized headings and excessive empty space.
- Buttons that look functional but do nothing.
- Monolithic components containing all business logic.
- Hardcoded business-specific layouts.

### Visual direction

Use a restrained enterprise design system:

- Font: Inter.
- Main background: `#F8FAFC`.
- Primary text: `#0F172A`.
- Borders: `#E2E8F0`.
- Primary accent: `#4F46E5`, unless overridden by the active site theme.
- Teal: `#0D9488`.
- Success: `#16A34A`.
- Warning: `#D97706`.
- Error: `#DC2626`.
- Information: `#2563EB`.
- Standard corner radius: approximately 8px.
- Consistent spacing scale.
- Compact, aligned tables.
- Clear page titles and action hierarchy.
- Semantic status badges with text labels.
- Lucide icons used sparingly and consistently.
- Visible keyboard focus states.
- Responsive layouts suitable for operational desktop workflows.

The interface should feel like a mature ERP, inventory-management, or operations platform.

### Implement these real screens

1. Login.
2. Main application hub.
3. Site selection and switching.
4. Configured site dashboard.
5. Module navigation and pages.
6. Inventory table and inventory detail.
7. Request list and request form.
8. Approval queue.
9. Assignment and consumption screens.
10. Return and PCB repair screens.
11. Visual configuration builder.
12. Configuration validation and preview.
13. Release history and publish/rollback interface.
14. Security and Trust Console.

Implement a cohesive, working foundation for these screens. It is acceptable to leave advanced module workflows incomplete if they are clearly labelled and their contracts are defined.

### Application shell

Implement:

- Persistent sidebar or topbar, determined by configuration.
- Site switcher.
- Breadcrumbs.
- Page title and contextual actions.
- Role-aware navigation.
- Notification feedback.
- Loading, empty, error, and success states.
- Accessible forms.
- Reusable tables, dialogs, inputs, buttons, and status indicators.
- Proper unknown-route and unknown-module handling.

Avoid duplicating UI logic across the three sites.

### Universal renderer

Build a genuinely configuration-driven renderer using a module registry and dedicated layout components.

The renderer must:

- Resolve a module type through a registry.
- Validate that a module is supported.
- Render the correct component using typed configuration.
- Apply site theme tokens.
- Respect layout definitions.
- Respect role-based visibility.
- Display useful errors for unsupported or invalid configuration.
- Avoid arbitrary component execution from configuration.
- Avoid a giant conditional component.
- Never branch on a specific site slug to render business functionality.

### Data honesty

Development seed data is acceptable and useful.

However:

- Identify demo data as demo data.
- Do not label hardcoded numbers as live data.
- Do not fake API success.
- Do not mutate UI state as though a database transaction succeeded.
- Do not silently replace API errors with fabricated content.
- If an endpoint is unavailable, display a meaningful unavailable state.

Keep mock providers separate from real implementations and make their status explicit.

## 8. DATABASE DESIGN — DOMAIN-CORRECT, NOT GENERIC AI SCHEMA

Design a coherent PostgreSQL relational model using Drizzle.

Do not create one generic operational table with arbitrary JSONB payloads for inventory, requests, approvals, assignments, returns, and repairs.

Do not create tables without a defined purpose.

### Core tables

At minimum, model the following entities with appropriate relationships:

- `users`
- `roles`
- `user_site_roles`
- `sites`
- `site_releases`
- `site_active_releases`
- `inventory_items`
- `stock_ledger`
- `requests`
- `approvals`
- `assignments`
- `consumption_records`
- `return_records`
- `repair_records`
- `audit_events`
- `idempotency_keys`

Add supporting tables only when the domain requires them, such as workflow definitions or explicit assignment-to-item relationships.

### Schema requirements

Every table must have a clear purpose and appropriately designed:

- Primary key.
- Foreign keys.
- Unique constraints.
- Check constraints.
- Indexes based on actual access patterns.
- Required and nullable fields.
- Tenant ownership.
- Created/updated timestamps where appropriate.
- Deletion semantics.
- Audit requirements.
- Appropriate status representation.

Use UUID primary keys.

Use UTC timestamps and serialize API timestamps as ISO 8601 strings.

Use snake_case for database columns and camelCase for TypeScript/API fields.

Do not use floating-point arithmetic for money. Use suitable exact numeric representations. Use integers for indivisible stock units and an appropriate exact representation for fractional quantities.

Use JSONB for versioned site configuration, release snapshots, and justified flexible metadata. Do not use it as a replacement for relational business records.

Define explicit relationships among requests, approvals, assignments, stock transactions, returns, and repairs.

Do not store duplicated information unless there is a documented reason and a consistency mechanism.

### Inventory correctness

Implement these invariants:

- Stock must never become negative.
- Stock allocation must be atomic.
- Concurrent allocations must not oversell inventory.
- Every stock-changing transaction must produce an auditable ledger entry.
- An assignment must reference a valid request and the necessary approval state.
- Failed transactions must roll back all associated mutations.
- Retried requests must not create duplicate stock movements.
- Stock summaries must be reconcilable with the ledger.

Use database transactions and suitable locking or atomic conditional updates. Do not rely only on checking stock in application memory.

Add a concurrency integration test that runs 50 competing allocation attempts against limited stock and verifies the actual database outcome.

### Tenant isolation

Every tenant-owned operational record must be scoped to its site.

Implement:

- Centralized tenant-scoped repository access.
- Explicit site membership checks.
- Transaction-scoped tenant context where appropriate.
- PostgreSQL Row-Level Security policies.
- `FORCE ROW LEVEL SECURITY` where appropriate.
- A normal application database role that is not a superuser and does not have `BYPASSRLS`.
- Separate migration/admin privileges from normal application privileges.

No route handler may perform arbitrary unscoped tenant queries.

Test cross-site access attempts, missing tenant context, and tenant-context leakage when database connections are pooled.

Document how migrations and seed operations work with RLS.

## 9. SHARED CONTRACTS — SINGLE SOURCE OF TRUTH

The package `packages/contracts` must own shared API and domain contracts.

At minimum, define Zod schemas and corresponding TypeScript types for:

### Common

- `ApiResponse<T>`
- `ApiError`
- `PaginationRequest`
- `PaginatedResponse<T>`
- `HealthResponse`

### Authentication and authorization

- `User`
- `Role`
- `AuthSession`
- `LoginRequest`
- `LoginResponse`
- Site membership and permission contracts.

### Sites and configuration

- `SiteSummary`
- `SiteConfiguration`
- `SiteTheme`
- `SiteShellType`
- `LayoutType`
- `SiteModule`
- `ConfigurationDraft`
- `ConfigurationValidationResult`
- `ValidationIssue`

### Module registry and visual builder

- `ModuleDefinition`
- `ModuleNode`
- `ModuleEdge`
- `PortDefinition`
- `DataTypeDefinition`
- Module configuration and port compatibility schemas.

### Releases

- `Release`
- `ReleaseSummary`
- `ReleaseDiff`
- Publish and rollback request/response contracts.

### Operations

- `WorkflowStatus`
- `RequestRecord`
- `ApprovedRequest`
- `StockItem`
- `Assignment`
- `ConsumptionRecord`
- `ReturnRecord`
- `RepairRecord`
- `AuditEvent`

Use separate schemas for database entities, API DTOs, request payloads, and frontend form state when their responsibilities differ.

Do not recreate the same contract independently in the frontend and backend.

Do not expose password hashes or sensitive internal database fields through API DTOs.

## 10. CONFIGURATION SCHEMA AND VALIDATION COMPILER

Build a real configuration contract and deterministic validation pipeline.

A site configuration should include:

- `schemaVersion`
- `siteId`
- `slug`
- `name`
- `theme`
- `shell`
- `layouts`
- `modules`
- `pages`
- `roles`
- `navigation`
- `workflowDefinitions`
- `calculatedFieldDefinitions`
- `metadata`

The visual graph must use typed nodes and edges.

Node structure:

- `id`
- `moduleType`
- `position`
- `config`

Edge structure:

- `id`
- `sourceNodeId`
- `sourcePortId`
- `targetNodeId`
- `targetPortId`

### Compiler stages

Implement a deterministic pipeline with clear errors:

1. Parse the incoming configuration.
2. Validate the configuration schema.
3. Validate schema version.
4. Resolve module types through the module registry.
5. Validate unique node and edge IDs.
6. Validate node references.
7. Validate source and target ports.
8. Validate port data-type compatibility.
9. Validate module dependencies.
10. Detect invalid dependency cycles.
11. Validate page and layout references.
12. Validate role and permission references.
13. Validate workflow transitions.
14. Validate calculated-field expressions.
15. Return structured errors and warnings.
16. Produce a compiled configuration only when blocking errors are absent.

Use Zod for schema validation and a restricted expression parser such as `jsep` for calculated fields.

Never execute arbitrary JavaScript from configuration.

Reject unsupported functions, properties, expressions, and invalid data types.

The same validator must be used by local config tooling and backend release endpoints.

Implement configuration schema migrations explicitly. Older configuration versions must be migrated through a defined path or rejected with an actionable error.

## 11. MODULE REGISTRY

Create 13 module definitions:

1. Authentication and RBAC — platform module.
2. User Management.
3. Inventory.
4. Dashboard Shell, Navigation and Forms — platform module.
5. Request.
6. Approval.
7. Material Assignment.
8. Assignment Frontend.
9. Consumption Tracking.
10. Return Management.
11. PCB Repair.
12. Analytics Dashboard.
13. Reports with Excel.

Every registry entry must define meaningful:

- `type`
- `displayName`
- `category`
- `description`
- `version`
- `ports`
- `dependencies`
- `schema`
- `permissions`
- `defaults`
- `platformModule`
- `frontendRenderer`
- `backendService`

The two platform modules are mandatory and non-removable.

Enforce dependencies and platform restrictions in the compiler and backend, not only in the UI.

The registry must be the common source of module metadata used by the builder, validator, runtime, and API.

Do not pretend every module is fully implemented just because a registry entry exists.

## 12. VISUAL CONFIGURATION BUILDER

Implement a useful foundational builder with `@xyflow/react`.

The builder must support:

- Displaying module nodes.
- Adding supported modules.
- Connecting compatible ports.
- Editing node configuration.
- Deleting permitted non-platform nodes.
- Displaying validation errors.
- Saving a draft.
- Previewing a valid draft.
- Publishing through the release API.
- Displaying a release status and version.

Use typed module definitions and real compiler results.

Prevent invalid connections and clearly explain validation errors.

Keep graph state, serialized configuration, validation output, and published release state conceptually separate.

Do not let the frontend alone decide whether a configuration can be published.

## 13. RELEASE AND PUBLISHING SYSTEM

Implement a configuration release lifecycle:

- Draft.
- Validation.
- Preview.
- Publish.
- Immutable release snapshot.
- Active release pointer.
- Release history.
- Configuration diff.
- Rollback.
- Audit events.

Requirements:

- Publishing requires successful server-side validation.
- A published release is immutable.
- Updating the active release must be atomic.
- Publishing must not require an application restart.
- A stale draft must be detected and rejected with HTTP 409 when appropriate.
- Rollback creates a new release or active version transition according to a documented model; it must not delete history.
- In-flight workflows must preserve the configuration version required to interpret their state.
- Release history and audit records must be queryable.
- Failed publishing must not leave a partially active configuration.

Use explicit release versions and transactional updates.

## 14. BACKEND API

Prefix endpoints with `/api/v1`.

Implement a consistent API with centralized validation, error handling, authentication, authorization, request IDs, and structured logging.

Required endpoint groups:

### Authentication

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Sites

- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId`
- `GET /api/v1/sites/:siteId/config`

### Modules and configuration

- `GET /api/v1/modules`
- `POST /api/v1/sites/:siteId/config/validate`
- `POST /api/v1/sites/:siteId/config/preview`
- `PUT /api/v1/sites/:siteId/config/draft`

### Releases

- `GET /api/v1/sites/:siteId/releases`
- `POST /api/v1/sites/:siteId/releases/publish`
- `POST /api/v1/sites/:siteId/releases/rollback`
- `GET /api/v1/sites/:siteId/releases/:releaseId/diff`

### Inventory and operations

- Inventory listing and detail endpoints.
- Request creation and retrieval.
- Approval actions.
- Assignment actions.
- Consumption recording.
- Return management.
- Repair management.
- Reports and analytics endpoints where implemented.

### Platform health

- `GET /api/v1/health`
- `GET /api/v1/ready`

Implement authentication, health checks, site listing, active configuration retrieval, module registry retrieval, and configuration validation as real, working vertical slices.

For other endpoints, either implement a real working contract or return a consistent, honest `501 Not Implemented` response. Never return fabricated successful business results.

Generate or maintain OpenAPI documentation consistent with implemented endpoints.

## 15. SECURITY

Implement:

- Password hashing using bcrypt.
- JWT verification and expiration.
- A documented token revocation/logout strategy.
- Server-side role and permission checks.
- Site membership checks.
- Tenant-scoped data access.
- Zod request validation.
- Rate limiting for authentication.
- Safe CORS configuration.
- Secure HTTP headers.
- Centralized error handling.
- Structured logging without secrets.
- Audit logging for security-sensitive operations.
- Protection against mass assignment.
- Safe environment configuration.
- No hardcoded credentials.
- No sensitive information in frontend bundles.

Never trust a client-supplied site ID without verifying that the authenticated user is authorized for that site.

Do not use a JWT merely because a token exists; validate its signature, expiration, and intended claims.

Document how secret rotation and token invalidation would work.

## 16. WORKFLOW AND INVENTORY TRANSACTIONS

Implement clear domain service boundaries.

A request may require approval before assignment.

A material assignment must respect the request state and available stock.

Consumption and returns must produce auditable state transitions and appropriate ledger entries.

PCB repair must have explicit statuses and permitted transitions.

Use database transactions for multi-step business mutations.

Use idempotency keys for suitable mutation endpoints.

Ensure that retrying an operation cannot accidentally allocate stock twice.

Use conditional updates, row locks, or equivalent database-level concurrency control where appropriate.

Write tests for invalid state transitions and rollback on failure.

Do not build a generic workflow engine more complex than the current requirements justify. Start with explicit typed workflow definitions and deterministic transition validation.

## 17. FRONTEND ARCHITECTURE

Keep business logic out of presentational components.

Use:

- Feature-based folders.
- A small reusable UI component set.
- Typed API clients.
- Shared contract types.
- Zustand for appropriate global UI/session state.
- React Hook Form and Zod for forms.
- Dedicated layouts.
- A module renderer registry.
- Explicit loading and error states.
- Reusable pagination and table patterns.

Avoid duplicated Axios clients, duplicated contracts, giant components, and excessive global state.

Do not store sensitive authentication tokens in local storage without a deliberate security assessment. Prefer an appropriately configured secure cookie strategy when compatible with the architecture; document CSRF protections and local-development behavior.

Create a consistent API error model and display useful user-facing error messages without exposing internal stack traces.

## 18. ANALYTICS AND EXCEL REPORTS

Use Recharts only where charts provide useful operational information.

Do not fill charts with invented metrics and label them live.

Create typed analytics response contracts and implement basic aggregations from actual persisted records when feasible.

Use ExcelJS for export.

Ensure exports are scoped to the authorized site and permission set.

Prevent spreadsheet formula injection when exporting untrusted user-provided strings.

If analytics endpoints are not yet implemented, show a clear demo or unavailable state instead of fabricated data.

## 19. TRUST CONSOLE

Create a Trust Console that displays real evidence about the system's correctness.

It should eventually surface:

- Configuration validation status.
- Release and audit history.
- Tenant isolation test results.
- RBAC test results.
- Inventory concurrency test results.
- Stock ledger reconciliation results.
- Build and integration-test status.

Never display hardcoded green checks implying tests passed.

Where checks have not run, show `Not run`. Where checks fail, show the failure. Distinguish test-environment evidence from production monitoring.

Build the underlying result contracts and an initial honest UI. Integrate real CI or test artifacts when feasible.

## 20. AI ASSISTANCE BOUNDARY

AI assistance may be integrated later to suggest configuration changes.

For the initial foundation:

- Define a provider interface.
- A clearly labelled local mock provider is acceptable.
- Model output must be treated as untrusted input.
- AI may propose a constrained configuration patch.
- The patch must pass the same deterministic compiler and authorization checks as human-authored changes.
- AI must never publish directly.
- A human must review and approve publication.
- Do not create a fake AI integration that claims to call a real model.

Do not spend time implementing a complex AI subsystem before the configuration compiler and release lifecycle work correctly.

## 21. PROGRESSIVE WEB APP

Set up the PWA foundation using `vite-plugin-pwa`.

Implement sensible installability and caching rules.

Cache only safe application assets and appropriately selected read-only data.

Do not cache sensitive operational responses indiscriminately.

Disable unsafe mutations when offline. Do not queue inventory writes for later execution in the initial version.

Clearly indicate offline status and unavailable functionality.

## 22. DATABASE MIGRATIONS AND SEEDING

Create repeatable Drizzle migrations and deterministic seed scripts.

Seed:

- Three demo sites.
- Required platform modules.
- Demo users and roles for local development.
- Minimal, realistic inventory and operational records only where the corresponding domain functionality exists.
- The three site configuration files.

Never put real credentials or production secrets in the repository.

Provide documented local-only demo credentials if required, and clearly identify them as development credentials.

Seed scripts should be safe to rerun and must not create duplicate records.

Implement a configuration validation script that checks all seeded site JSON files.

## 23. TESTING REQUIREMENTS

Create tests that exercise behavior rather than merely checking that files exist.

### Unit tests

- Configuration schema validation.
- Module registry resolution.
- Port compatibility.
- Dependency validation.
- Cycle detection.
- Calculated-field parsing.
- Workflow transition validation.
- Release diff behavior.
- API error serialization.

### API integration tests

- Login and invalid credentials.
- Unauthorized access.
- Site membership checks.
- Cross-site record access.
- Configuration retrieval.
- Invalid configuration rejection.
- Publish validation and stale draft handling.
- Audit record creation.
- Inventory transaction rollback.
- Idempotent mutation behavior.

### Database security tests

- Missing tenant context.
- Cross-site access.
- RLS enforcement.
- Normal application role privileges.
- Pooled-connection tenant-context leakage.
- Tenant isolation for each major operational table.

### Inventory tests

- No negative stock.
- Concurrent allocations.
- Stock ledger reconciliation.
- No duplicate ledger entries on retry.
- Approved-request requirement.
- Full rollback when any transaction step fails.

### Frontend tests

- Login form validation.
- Site switching.
- Configuration-driven module rendering.
- Unsupported module fallback.
- Loading, empty, and error states.
- Builder validation feedback.
- Publish state handling.
- Role-aware navigation.

### Playwright smoke tests

At minimum, cover the core demo flow:

1. Launch the application.
2. Log in using local development credentials.
3. Open the site hub.
4. Enter Central Stores.
5. Switch to Service Centre.
6. Switch to Distribution.
7. Open the configuration builder.
8. Validate a configuration.
9. Publish a valid configuration if the full release flow is implemented.
10. Verify the resulting runtime behavior.

Do not claim tests passed unless the corresponding commands ran and their exit statuses were observed.

## 24. FOUR-PERSON TEAM OWNERSHIP

Create `docs/team-workflow.md` and document these boundaries.

### Person 1 — Frontend and Runtime UI

Owns:

- `apps/web/src/components/`
- `apps/web/src/features/`
- `apps/web/src/runtime/`
- Design system.
- Shared forms and tables.
- Dashboard and layout rendering.
- Builder UI.
- Release UI.

### Person 2 — Backend, Database and Security

Owns:

- `apps/api/src/db/`
- `apps/api/src/middleware/`
- `apps/api/src/repositories/`
- Backend authentication and authorization.
- Tenant isolation.
- Inventory transactions.
- Operational domain services.
- Security and database integration tests.

### Person 3 — Configuration Brain and Automation

Owns:

- `apps/api/src/compiler/`
- `apps/api/src/releases/`
- `apps/api/src/modules/`
- Workflow definitions and validation.
- Module registry.
- Configuration schema validation.
- Graph validation.
- Expression parser.
- AI provider interface.
- Configuration presets.
- Coordinated shared-contract changes.

### Person 4 — Integration, QA and Delivery

Owns:

- Playwright end-to-end tests.
- GitHub Actions CI.
- Docker Compose integration.
- API contract integration.
- Trust Console integration.
- PWA integration.
- Demo reset scripts.
- Architecture and demo documentation.
- Cross-team integration and acceptance checks.

Shared contracts are jointly governed. Changes must be communicated to affected owners before implementation.

Create `docs/architecture.md`, `docs/database.md`, `docs/api-contract.md`, `docs/configuration-schema.md`, `docs/module-registry.md`, `docs/security.md`, and `docs/demo-runbook.md`.

Document clear ownership, exported interfaces, and integration dependencies so all four people can work in parallel without modifying each other's internals unnecessarily.

## 25. REQUIRED DEVELOPER EXPERIENCE

Provide root-level npm scripts where relevant:

- `dev`
- `dev:web`
- `dev:api`
- `build`
- `lint`
- `format`
- `typecheck`
- `test`
- `test:unit`
- `test:integration`
- `test:e2e`
- `db:generate`
- `db:migrate`
- `db:seed`
- `db:reset`
- `config:validate`
- `demo:reset`

Use scripts that actually exist and work. Do not add fake script names.

Create Docker Compose for local PostgreSQL and the services needed for the development workflow.

Provide `.env.example` with safe placeholders.

Document how to install dependencies, configure environment variables, start the database, run migrations, seed data, start the app, run tests, and reset the demo.

Add a GitHub Actions workflow that runs, as applicable:

- Dependency installation.
- Linting.
- Type checking.
- Unit tests.
- Configuration validation.
- Build.
- Database integration tests.

Add lightweight CI checks for prohibited site-specific conditional logic, `eval`, hardcoded secrets, duplicate contracts, and unsafe tenant access where practical. Do not introduce fragile source-code checks that create false positives without explanation.

## 26. IMPLEMENTATION ORDER

Work in this sequence.

### Phase 1 — Inspect and establish the repository

- Inspect existing files and Git status.
- Preserve existing work.
- Establish npm workspaces.
- Configure TypeScript, linting, formatting, and environment handling.
- Create the shared contracts package.
- Establish frontend and backend entry points.

### Phase 2 — Database and domain foundation

- Design the relational schema.
- Create migrations.
- Configure PostgreSQL and Drizzle.
- Implement seed scripts.
- Establish tenant-scoped database access and RLS.
- Test migrations and seeding.

### Phase 3 — Configuration and module registry

- Define strict Zod schemas.
- Create the 13-module registry.
- Create the three site configurations.
- Implement deterministic validation.
- Implement a config validation CLI.
- Test valid and invalid configurations.

### Phase 4 — Real frontend foundation

- Implement login.
- Implement the application shell.
- Implement site hub and switching.
- Implement module registry integration.
- Implement configuration-driven rendering.
- Implement shared forms, tables, and feedback components.
- Apply the professional industrial UI design requirements.

### Phase 5 — Backend vertical slices

Implement real authentication, health checks, site listing, configuration retrieval, module registry retrieval, and configuration validation.

Implement tenant isolation and consistent API errors before adding more operational endpoints.

### Phase 6 — Builder and releases

- Implement builder foundation.
- Integrate compiler results.
- Implement preview.
- Implement immutable releases.
- Implement publishing and rollback.
- Add audit events and release history.
- Demonstrate configuration changes through the shared runtime.

### Phase 7 — Tests, integration, and documentation

- Run unit tests.
- Run database integration tests.
- Run frontend tests.
- Run end-to-end smoke tests where feasible.
- Fix failures.
- Complete developer documentation.
- Prepare the demo runbook.

If time or environment constraints prevent a phase from being completed, finish the earlier phases properly, document the blocker, and avoid generating large amounts of untested code to create the illusion of progress.

## 27. DEFINITION OF DONE

The initial repository foundation is complete only when the following are true, to the extent supported by the available environment:

- npm workspace structure is valid.
- Dependencies install successfully or any blocker is documented.
- Frontend and backend start successfully.
- TypeScript compiles.
- Linting runs.
- Database migrations apply to a clean PostgreSQL database.
- Seed scripts are repeatable.
- All three site configurations validate.
- Module registry contracts are consistent.
- The universal renderer is configuration-driven.
- Site differences do not depend on hardcoded site-slug branches.
- Core API vertical slices work.
- Tenant isolation is enforced and tested.
- Inventory invariants have database-level enforcement and tests.
- Release publishing cannot bypass server-side validation.
- The UI uses real service responses or clearly labelled development fixtures.
- Incomplete features are clearly identified.
- Documentation describes actual implementation, not intended future behavior.
- The four-person ownership model is documented.

Do not use the number of files or the size of the codebase as evidence of completion.

## 28. HOW YOU MUST WORK IN CLAUDE CODE

Follow these rules throughout execution:

1. Start by inspecting the repository and identifying existing files, scripts, and constraints.
2. Summarize your implementation plan briefly, then begin modifying the repository.
3. Create actual source files and configuration files.
4. Prefer coherent, working vertical slices over broad placeholder implementations.
5. Run commands using the actual package scripts and available environment.
6. Diagnose failures and fix them instead of hiding them.
7. Do not report success based solely on code inspection.
8. Do not claim Docker, PostgreSQL, browser, or external service checks ran if the required service was unavailable.
9. Do not fabricate screenshots, test results, database rows, or API responses.
10. Do not replace a failed test with a weaker test simply to obtain a pass.
11. Do not overwrite user changes or discard uncommitted work.
12. Keep changes aligned with the team ownership boundaries.
13. If you must choose between visual polish and architectural correctness, preserve architectural correctness while still delivering a clean, usable UI.
14. If you must choose between an honest incomplete implementation and a fake complete implementation, choose the honest incomplete implementation.

At the end, provide a concise implementation report containing:

- What was actually created.
- Which important flows are functional.
- The exact commands executed.
- Which checks passed.
- Which checks failed.
- Which checks could not run and why.
- Any known security or implementation gaps.
- How to start the application locally.
- The next three highest-priority tasks for the four-person team.

**Begin by inspecting the current repository. Then implement the foundation directly. Do not stop after writing a plan.**