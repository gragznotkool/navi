import { expect, test, type Page } from "@playwright/test";

// Local development credentials from the seed (see docs/demo-runbook.md).
const PASSWORD = "opshub-dev-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
}

test("rejects bad credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@opshub.local");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid email or password");
});

test("core demo: sites, switching, builder, publish, runtime change, rollback", async ({ page }) => {
  await login(page, "admin@opshub.local");
  await expect(page.getByRole("link", { name: /Central Stores/ })).toBeVisible();

  // Central Stores: sidebar shell, teal accent, inventory from the database.
  await page.getByRole("link", { name: /Central Stores/ }).click();
  await expect(page.locator("aside")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByRole("cell", { name: "BRG-6204" })).toBeVisible();

  // Switch to Service Centre: top navigation, no sidebar.
  await page.getByLabel("Switch site").selectOption("service-centre");
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "PCB Repair" })).toBeVisible();

  // Switch to Distribution: workbench shell, no Returns yet.
  await page.getByLabel("Switch site").selectOption("distribution");
  await expect(page.locator("header.bg-slate-900")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Returns" })).toHaveCount(0);

  // Builder: add Return Management, validate on the server, publish.
  await nav.getByRole("link", { name: "Configuration builder" }).click();
  await expect(page.getByRole("button", { name: "Review & publish" })).toBeDisabled();
  await page.getByLabel("Add module").selectOption({ label: "Return Management" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("No errors or warnings.")).toBeVisible();
  await page.getByRole("button", { name: "Review & publish" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/“Return Management” module is added, with a new “Returns” tab/)).toBeVisible();
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Releases" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Active" })).toBeVisible();

  // The common runtime now shows the module; no restart or redeploy happened.
  const nav2 = page.getByRole("navigation", { name: "Main" });
  await nav2.getByRole("link", { name: "Returns" }).click();
  await expect(page.getByText("Not implemented yet", { exact: true })).toBeVisible();

  // Roll back: Returns disappears again, history is preserved.
  await nav2.getByRole("link", { name: "Releases" }).click();
  await page.getByRole("button", { name: "Roll back to version 1", exact: true }).click();
  const rollbackDialog = page.getByRole("dialog");
  await expect(rollbackDialog.getByText(/module is removed/)).toBeVisible();
  await rollbackDialog.getByRole("checkbox").check();
  await rollbackDialog.getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByRole("link", { name: "Returns" })).toHaveCount(0);
  await expect(page.getByText("Rollback to version 1").first()).toBeVisible();
});

test("builder blocks an invalid draft: removing a dependency is rejected by the server", async ({ page }) => {
  await login(page, "admin@opshub.local");
  await page.goto("/s/service-centre/admin/builder");
  await page.getByText("Request", { exact: true }).first().click();
  await page.getByRole("button", { name: "Remove module" }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText(/requires "request"/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review & publish" })).toBeDisabled();
});

test("role-aware access: storekeeper sees only their site and no admin tools", async ({ page }) => {
  await login(page, "storekeeper@opshub.local");
  await expect(page.getByRole("link", { name: /Service Centre/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Central Stores/ }).click();
  await expect(page.getByText("Configuration builder")).toHaveCount(0);
  await page.goto("/s/distribution");
  await expect(page.getByText("Site not found")).toBeVisible();
});

test("request to assignment flow across roles", async ({ page, context }) => {
  await login(page, "dispatcher@opshub.local");
  await page.goto("/s/distribution/requests");
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByLabel("Item").selectOption({ index: 1 });
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Request submitted")).toBeVisible();
  await context.clearCookies();

  await login(page, "approver@opshub.local");
  await page.goto("/s/distribution/approvals");
  await page.getByRole("button", { name: /^Approve request/ }).first().click();
  await expect(page.getByText(/approved/).first()).toBeVisible();
});

test("hiding a field: plain-English impact, confirmation, data kept, restored by rollback", async ({ page }) => {
  await login(page, "admin@opshub.local");
  await page.goto("/s/central-stores/inventory");
  await expect(page.getByRole("columnheader", { name: "Unit price" })).toBeVisible();

  await page.goto("/s/central-stores/admin/builder");
  await page.getByRole("button", { name: "Hide field Unit price" }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("No errors or warnings.")).toBeVisible();
  await page.getByRole("button", { name: "Review & publish" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/3 rows keep the saved value/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Releases" })).toBeVisible();

  await page.goto("/s/central-stores/inventory");
  await expect(page.getByRole("columnheader", { name: "Unit price" })).toHaveCount(0);

  // Roll back to the version that still showed the field: the saved prices are back.
  await page.goto("/s/central-stores/admin/releases");
  await page.getByRole("button", { name: "Roll back to version 1", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Roll back" }).click();
  await page.goto("/s/central-stores/inventory");
  await expect(page.getByRole("columnheader", { name: "Unit price" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "180" })).toBeVisible();
});
