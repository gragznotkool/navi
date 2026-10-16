import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "opshub-dev-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
}

// A fresh site per run, so the 10-second deadline never touches the seeded demo sites.
const stamp = Date.now().toString(36);
const slug = `sla-${stamp}`;
const name = `SLA Depot ${stamp}`;

test("hub routes, Ctrl+K from any page, and a live SLA ring that turns overdue without a refresh", async ({ page }) => {
  await login(page, "admin@opshub.local");

  // ---- Hub routes
  await page.goto("/hub/sites");
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
  await page.getByRole("link", { name: "Builder", exact: true }).click();
  await expect(page).toHaveURL(/\/hub\/builder$/);
  await expect(page.getByRole("heading", { name: "Configuration builder" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Sites you can configure" }).getByText("Central Stores")).toBeVisible();

  // ---- A new site with a 10 second approval deadline
  await page.goto("/sites/new");
  await page.getByLabel("Site name").fill(name);
  await page.getByLabel("Address (slug)").fill(slug);
  await page.getByLabel(/Add demo stock/).check();
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByText(/Committed\. The site is live/)).toBeVisible();

  await page.goto(`/s/${slug}/admin/builder`);
  await page.getByText("Approval", { exact: true }).first().click();
  await page.getByLabel("Approval deadline (seconds)").fill("10");
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("No errors or warnings.")).toBeVisible();
  await page.getByRole("button", { name: "Review & publish" }).click();
  await expect(page.getByRole("dialog").getByText(/turn overdue after 10 seconds/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Releases" })).toBeVisible();

  // ---- Raise a request
  await page.goto(`/s/${slug}/requests`);
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByLabel("Item").selectOption({ index: 1 });
  await page.getByLabel("Quantity").fill("1");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Request submitted")).toBeVisible();

  // ---- The ring counts down on the approval queue and goes red with no reload
  await page.goto(`/s/${slug}/approvals`);
  const ring = page.locator("[data-sla]").first();
  await expect(ring).toBeVisible();
  await expect(ring).toHaveText(/\d+s left|Overdue by/);
  await expect(ring).toHaveAttribute("data-sla", "breached", { timeout: 20_000 });
  await expect(ring).toContainText("Overdue by");

  // ---- Ctrl+K from this page: filter, run with the keyboard
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Search commands" });
  await expect(box).toBeFocused();
  await box.fill("rewind");
  await expect(page.getByRole("listbox", { name: "Commands" }).getByRole("option").first()).toContainText("Rewind");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/admin/rewind`));

  // Site switching, then Escape closes without navigating.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("switch to central");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/s\/central-stores\/[a-z-]+$/); // wait for the site index to redirect to its first page
  const here = page.url();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  expect(page.url()).toBe(here);
});
