import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "opshub-dev-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
}

test("Bolo & Build proposes a change, applies it to the draft only, and never publishes", async ({ page }) => {
  await login(page, "admin@opshub.local");
  await page.goto("/s/service-centre/admin/builder");
  const releasesBefore = await page.evaluate(async () => (await fetch("/api/v1/sites/00000000-0000-4000-8000-000000000002/releases", { credentials: "include" })).json());

  await page.getByLabel("What should change?").fill("rename the site to Pune Service Hub");
  await page.getByRole("button", { name: "Propose change" }).click();
  const proposal = page.getByLabel("Proposed change");
  await expect(proposal).toBeVisible();
  // Either a model or the built-in fallback answered; both are labelled and both go through the same validation.
  await expect(proposal.getByText(/AI proposal|Built-in fallback/)).toBeVisible();
  await expect(proposal.getByRole("list", { name: "What this would change" })).toContainText("Pune Service Hub");

  await proposal.getByRole("button", { name: "Apply to draft" }).click();
  await expect(page.getByText("Unvalidated changes")).toBeVisible(); // the draft changed, nothing else did

  const releasesAfter = await page.evaluate(async () => (await fetch("/api/v1/sites/00000000-0000-4000-8000-000000000002/releases", { credentials: "include" })).json());
  expect(releasesAfter.data.length).toBe(releasesBefore.data.length); // nothing was published
  // Leave without publishing; the unsaved draft is discarded.
});

test("Excel: export downloads a real workbook and the same file previews as unchanged", async ({ page }, testInfo) => {
  await login(page, "storekeeper@opshub.local");
  await page.goto("/s/central-stores/inventory");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export inventory/ }).click()]);
  expect(download.suggestedFilename()).toBe("central-stores-inventory.xlsx");
  const path = testInfo.outputPath("inventory.xlsx");
  await download.saveAs(path);
  expect(readFileSync(path).subarray(0, 2).toString()).toBe("PK"); // a zip container, i.e. a real .xlsx

  await page.getByLabel("Import from Excel").setInputFiles(path);
  const preview = page.getByLabel("Import preview");
  await expect(preview).toContainText("Preview: nothing changed yet");
  await expect(preview).toContainText("0 with problems");
  await expect(page.getByText(/Nothing in this file would change anything/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Apply import/ })).toBeDisabled();

  // A wrong file type is refused in the browser before anything is uploaded.
  await page.getByLabel("Import from Excel").setInputFiles({ name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from("SKU,Name\nA,B\n") });
  await expect(page.getByRole("alert")).toContainText("ending in .xlsx");
});
