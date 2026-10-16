import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "opshub-dev-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
}

// Unique per run so the test can be repeated against the same development database.
const stamp = Date.now().toString(36);
const slug = `e2e-${stamp}`;
const name = `E2E Depot ${stamp}`;

test("provision a new site with a live log, then rewind it", async ({ page }) => {
  await login(page, "admin@opshub.local");

  // ---- Track E: one-save provisioning
  await page.getByRole("link", { name: "New site" }).click();
  await expect(page.getByRole("heading", { name: "Create a new site" })).toBeVisible();

  // Client-side validation uses the shared schema (reserved address).
  await page.getByLabel("Site name").fill("Trust Lab");
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByText("This name is reserved")).toBeVisible();

  await page.getByLabel("Site name").fill(name);
  await page.getByLabel("Address (slug)").fill(slug);
  await page.getByLabel(/Add demo stock/).check();
  // The live log must really use the Server-Sent Events stream through the dev proxy (not just polling).
  const stream = page.waitForResponse((r) => /\/provisioning\/.+\/events/.test(r.url()) && (r.headers()["content-type"] ?? "").includes("text/event-stream"));
  await page.getByRole("button", { name: "Create site" }).click();
  await stream;

  const log = page.getByRole("list", { name: "Provisioning log" });
  await expect(log.getByText("Site record created.")).toBeVisible();
  await expect(log.getByText("Release v1 is active.")).toBeVisible();
  await expect(log.getByText(/Committed\. The site is live/)).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Open site" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/`));
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  // It is also listed in the hub without any restart.
  await page.goto("/");
  await expect(page.getByRole("list").getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("link", { name: /Continue where you left off/ })).toBeVisible(); // last-site memory

  // Creating the same address again is refused with a clear message.
  await page.getByRole("link", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(`${name} again`);
  await page.getByLabel("Address (slug)").fill(slug);
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByRole("alert")).toContainText("already used by another site");

  // ---- Track F: publish v2 (add a field), then rewind to v1
  await page.goto(`/s/${slug}/admin/builder`);
  await page.getByLabel("New field label").fill("Shelf");
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("No errors or warnings.")).toBeVisible();
  await page.getByRole("button", { name: "Review & publish" }).click();
  const publishDialog = page.getByRole("dialog");
  await expect(publishDialog.getByText(/new text field “Shelf” is added to inventory items/)).toBeVisible();
  await publishDialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Releases" })).toBeVisible();

  await page.goto(`/s/${slug}/admin/rewind`);
  const slider = page.getByRole("slider", { name: "Release version" });
  await expect(slider).toHaveAttribute("max", "1");
  await expect(page.getByText("Active now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Roll back to v2" })).toBeDisabled();
  await expect(page.getByText(/new text field “Shelf” is added/)).toBeVisible();

  await slider.focus();
  await page.keyboard.press("ArrowLeft"); // drag back to v1 with the keyboard
  await expect(page.getByText("What version 1 changed")).toBeVisible();
  await expect(page.getByText(/This is the first release for/)).toBeVisible();
  await expect(page.getByText(/If you go back to version 1/)).toBeVisible();
  await expect(page.getByText(/“Shelf” field is removed from inventory items/)).toBeVisible();

  // Read-only preview of the historical version, then back.
  await page.getByRole("button", { name: "Preview version 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/preview/${slug}`));
  await page.goBack();

  // Roll back through the impact dialog; history is kept and the rollback is a new release.
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Roll back to v1" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/“Shelf” field is removed/)).toBeVisible();
  // Removing a field is destructive, so the dialog needs an explicit acknowledgement.
  await expect(dialog.getByRole("button", { name: "Roll back" })).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Roll back" }).click();

  await expect(slider).toHaveAttribute("max", "2");
  await page.goto(`/s/${slug}/admin/releases`);
  await expect(page.getByText("Rollback to version 1").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "v3" })).toBeVisible();
});

test("only platform admins see the New site entry", async ({ page }) => {
  await login(page, "storekeeper@opshub.local");
  await expect(page.getByRole("link", { name: "New site" })).toHaveCount(0);
  await page.goto("/sites/new");
  await expect(page.getByText("Platform administrators only")).toBeVisible();
});
