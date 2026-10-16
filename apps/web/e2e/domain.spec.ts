import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "opshub-dev-1";
const stamp = Date.now().toString(36).toUpperCase();

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
}

test("PCB repair: a technician receives a board and moves it through the workflow", async ({ page }) => {
  await login(page, "technician@opshub.local");
  await page.goto("/s/service-centre/pcb-repair");
  const serial = `E2E-${stamp}`;
  await page.getByLabel("Board serial").fill(serial);
  await page.getByRole("button", { name: "Receive board" }).click();
  await expect(page.getByText(serial, { exact: true })).toBeVisible();
  for (const step of ["Start diagnosis", "Start repair", "Send to test", "Complete"]) {
    await page.getByRole("button", { name: `${step}: ${serial}` }).click();
  }
  const row = page.getByRole("row", { name: new RegExp(serial) });
  await expect(row).toContainText("completed");
  await expect(row).toContainText("Finished");
  // A duplicate is refused with a clear message.
  await page.getByLabel("Board serial").fill(serial);
  await page.getByRole("button", { name: "Receive board" }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();
});

test("Stock adjustment writes the ledger and refuses to go below zero", async ({ page }) => {
  await login(page, "storekeeper@opshub.local");
  await page.goto("/s/central-stores/inventory");
  await page.getByRole("cell", { name: "BRG-6204" }).click();
  const form = page.getByRole("form", { name: "Adjust stock" });
  await form.getByLabel(/Change/).fill("5");
  await form.getByLabel("Reason").fill(`Found on shelf ${stamp}`);
  await form.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(page.getByText(/Stock is now/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "+5" }).first()).toBeVisible(); // the ledger shows it
  await form.getByLabel(/Change/).fill("-5");
  await form.getByLabel("Reason").fill(`Put back ${stamp}`);
  await form.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(page.getByText(/Stock is now/).first()).toBeVisible();
  await form.getByLabel(/Change/).fill("-99999");
  await form.getByLabel("Reason").fill(`Too much ${stamp}`);
  await form.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(form.getByRole("alert")).toContainText("Insufficient stock");
});

test("User management: add a person to a site, change their role, remove them", async ({ page }) => {
  await login(page, "admin@opshub.local");
  // Start from a known state, even if an earlier run stopped half-way.
  await page.evaluate(async () => {
    const site = "00000000-0000-4000-8000-000000000002";
    const list = (await (await fetch(`/api/v1/sites/${site}/members`, { credentials: "include" })).json()).data as { userId: string; email: string }[];
    const d = list.find((m) => m.email === "dispatcher@opshub.local");
    if (d) await fetch(`/api/v1/sites/${site}/members/${d.userId}`, { method: "DELETE", credentials: "include", headers: { "x-opshub-client": "web" } });
  });
  await page.goto("/s/service-centre/users");
  await page.getByLabel("Email of an existing account").fill("dispatcher@opshub.local");
  await page.getByLabel("Role", { exact: true }).selectOption({ label: "Technician" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("dispatcher@opshub.local", { exact: true })).toBeVisible();
  await page.getByLabel("Approver for dispatcher@opshub.local").click(); // applied when the server confirms
  await expect(page.getByLabel("Approver for dispatcher@opshub.local")).toBeChecked();
  // Your own roles cannot be edited here.
  await expect(page.getByLabel("Administrator for admin@opshub.local")).toBeDisabled();
  // Remove by clearing every role.
  await page.getByLabel("Technician for dispatcher@opshub.local").click();
  await expect(page.getByLabel("Technician for dispatcher@opshub.local")).not.toBeChecked();
  await page.getByLabel("Approver for dispatcher@opshub.local").click();
  await expect(page.getByText("dispatcher@opshub.local", { exact: true })).toHaveCount(0);
});

test("Analytics and Reports come from the server for the signed-in role", async ({ page }) => {
  await login(page, "storekeeper@opshub.local");
  await page.goto("/s/central-stores/analytics");
  await expect(page.getByText("Inventory items")).toBeVisible();
  await expect(page.getByText("Stock movements, last 14 days")).toBeVisible();
});
