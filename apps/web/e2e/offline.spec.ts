import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "opshub-dev-1";
const DIST = "00000000-0000-4000-8000-000000000003";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
}

const requestCount = (page: Page) =>
  page.evaluate(async (site) => {
    const res = await fetch(`/api/v1/sites/${site}/requests?page=1&pageSize=100`, { credentials: "include" });
    return ((await res.json()) as { data: { total: number } }).data.total;
  }, DIST);

test("a request raised offline is saved on the device and reaches the server exactly once on reconnect", async ({ page, context }) => {
  await login(page, "dispatcher@opshub.local");
  await page.goto("/s/distribution/requests");
  await page.getByRole("button", { name: "New request" }).click();
  await expect(page.getByLabel("Item 1")).toBeVisible(); // the item list is now saved on the device
  await page.getByRole("button", { name: "New request" }).click(); // close the form again
  const before = await requestCount(page);

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();

  // The form still opens (from the saved item list) and the request is queued instead of failing.
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByLabel("Item 1").selectOption({ index: 1 });
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Saved on this device. It will be sent when you are back online.")).toBeVisible();
  const saved = page.getByRole("region", { name: "Saved on this device" });
  await expect(saved).toContainText("Waiting to send");
  await expect(page.getByRole("status").filter({ hasText: "1 change is saved on this device" })).toBeVisible();

  await context.setOffline(false);
  await expect(saved).toHaveCount(0, { timeout: 20_000 }); // synced and removed from the queue
  await expect(page.getByRole("status").filter({ hasText: /waiting to be sent|will be sent when you reconnect|Syncing/ })).toHaveCount(0);

  const after = await requestCount(page);
  expect(after).toBe(before + 1); // exactly once

  // Nothing is left to replay: a second reconnect cycle adds nothing.
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(1500);
  expect(await requestCount(page)).toBe(before + 1);
});

test("assigning stock is blocked offline, with the reason shown", async ({ page, context }) => {
  await login(page, "dispatcher@opshub.local");
  await page.goto("/s/distribution/assignments");
  await expect(page.getByRole("heading", { name: /Assign/i }).first()).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/Assigning stock changes quantities/)).toBeVisible();
  await context.setOffline(false);
});

test("signing out removes the saved copy and unsent work from the device", async ({ page }) => {
  await login(page, "dispatcher@opshub.local");
  await page.goto("/s/distribution/requests");
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  const countBefore = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === "opshub-offline");
  });
  expect(countBefore).toBe(true); // the read cache was written
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("opshub-offline");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["cache", "outbox"]);
          let total = 0;
          const done = () => {
            db.close();
            resolve(total);
          };
          const c = tx.objectStore("cache").count();
          c.onsuccess = () => {
            total += c.result;
            const o = tx.objectStore("outbox").count();
            o.onsuccess = () => {
              total += o.result;
              done();
            };
          };
        };
        open.onerror = () => resolve(-1);
      }),
  );
  expect(left).toBe(0);
});
