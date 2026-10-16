import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, AuthSession } from "@opshub/contracts";
import { OfflineBanner } from "../src/components/feedback";
import { PendingOps } from "../src/components/PendingOps";
import { ApiRequestError, http } from "../src/lib/api";
import { cachedRead, clearOffline, dismiss, enqueue, listOutbox, refreshCounts, retry, setUserIdProvider, SYNCED_EVENT, syncNow } from "../src/lib/offline/engine";
import { memoryStore, setStoreForTests } from "../src/lib/offline/store";
import { useOffline } from "../src/stores/offline";
import { ConsumptionModule } from "../src/features/assignments/ConsumptionModule";
import { AssignmentsModule } from "../src/features/assignments/AssignmentsModule";
import { SiteRuntimeProvider } from "../src/runtime/context";
import { useSession } from "../src/stores/session";
import { configs } from "./helpers";

vi.mock("../src/services", () => ({
  opsApi: { assignments: vi.fn(), requests: vi.fn(), assign: vi.fn() },
}));
import { opsApi } from "../src/services";

const SITE = "10000000-0000-4000-8000-0000000000a1";
const OTHER_SITE = "10000000-0000-4000-8000-0000000000a2";
let user = "user-1";

const offlineError = () => new AxiosError("Network Error", "ERR_NETWORK"); // no response at all
const serverError = (status: number, code: string, message: string) => new AxiosError("fail", "ERR_BAD_REQUEST", undefined, undefined, { status, data: { error: { code, message } }, headers: {}, statusText: "", config: {} as never });
const syncReply = (results: { key: string; status: string; code?: string; reason?: string }[]) => ({ data: { data: { results } } });

beforeEach(() => {
  setStoreForTests(memoryStore());
  user = "user-1";
  setUserIdProvider(() => user);
  useOffline.setState({ pending: 0, rejected: 0, syncing: false, staleSince: null });
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("read cache", () => {
  it("serves the last copy when the server cannot be reached, and says so", async () => {
    expect(await cachedRead(SITE, "items:1", async () => ({ n: 1 }))).toEqual({ n: 1 });
    await new Promise((r) => setTimeout(r, 0)); // the copy is written in the background
    const value = await cachedRead(SITE, "items:1", async () => Promise.reject(offlineError()));
    expect(value).toEqual({ n: 1 });
    expect(useOffline.getState().staleSince).not.toBeNull();
    await cachedRead(SITE, "items:1", async () => ({ n: 2 })); // back online: the flag clears
    expect(useOffline.getState().staleSince).toBeNull();
  });

  it("never hides a real server error behind old data", async () => {
    await cachedRead(SITE, "x", async () => 1);
    await new Promise((r) => setTimeout(r, 0));
    await expect(cachedRead(SITE, "x", async () => Promise.reject(serverError(403, "forbidden", "No")))).rejects.toMatchObject({ response: { status: 403 } });
    await expect(cachedRead(SITE, "x", async () => Promise.reject(serverError(500, "internal_error", "Boom")))).rejects.toBeDefined();
  });

  it("with nothing saved it fails honestly", async () => {
    await expect(cachedRead(SITE, "never-seen", async () => Promise.reject(offlineError()))).rejects.toBeDefined();
  });

  it("one user's saved data is never shown to another, and is removed on sign-out", async () => {
    await cachedRead(SITE, "items:1", async () => ({ secret: "user-1 data" }));
    await new Promise((r) => setTimeout(r, 0));
    user = "user-2";
    await expect(cachedRead(SITE, "items:1", async () => Promise.reject(offlineError()))).rejects.toBeDefined();
    user = "user-1";
    await clearOffline();
    await expect(cachedRead(SITE, "items:1", async () => Promise.reject(offlineError()))).rejects.toBeDefined();
  });
});

describe("outbox and sync", () => {
  const post = (impl: (url: string, body: { ops: { key: string }[] }) => unknown) => vi.spyOn(http, "post").mockImplementation(((url: string, body: never) => Promise.resolve(impl(url, body))) as never);

  it("queues, then sends once: accepted operations leave the queue and the page is told to reload", async () => {
    const a = await enqueue(SITE, "request.create", { lines: [] }, "Request for BRG-6204");
    const b = await enqueue(SITE, "consumption.record", { assignmentId: "x", quantity: 1 }, "Consumption");
    expect(useOffline.getState()).toMatchObject({ pending: 2, rejected: 0 });
    const spy = post((_u, body) => syncReply(body.ops.map((o) => ({ key: o.key, status: o.key === a!.id ? "applied" : "duplicate" }))));
    const synced = vi.fn();
    window.addEventListener(SYNCED_EVENT, synced);
    expect(await syncNow()).toBe(2);
    window.removeEventListener(SYNCED_EVENT, synced);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(`/sites/${SITE}/sync`);
    expect(spy.mock.calls[0]![1]).toMatchObject({ ops: [{ key: a!.id, type: "request.create" }, { key: b!.id, type: "consumption.record" }] });
    expect(await listOutbox(SITE)).toEqual([]);
    expect(useOffline.getState()).toMatchObject({ pending: 0, rejected: 0, syncing: false });
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("a rejected operation stays visible with the server's reason, and is not sent again until retried", async () => {
    const a = await enqueue(SITE, "consumption.record", { assignmentId: "x", quantity: 9 }, "Consumption of 9");
    const spy = post((_u, body) => syncReply(body.ops.map((o) => ({ key: o.key, status: "rejected", code: "over_consumption", reason: "Only 1 unit(s) remain unconsumed on this assignment" }))));
    expect(await syncNow()).toBe(0);
    const [item] = await listOutbox(SITE);
    expect(item).toMatchObject({ id: a!.id, state: "rejected", code: "over_consumption", reason: expect.stringMatching(/Only 1/) });
    expect(useOffline.getState()).toMatchObject({ pending: 0, rejected: 1 });
    await syncNow();
    expect(spy).toHaveBeenCalledTimes(1); // rejected items are not resent on their own
    await retry(a!.id);
    expect(useOffline.getState().pending).toBe(1);
    await dismiss(a!.id);
    expect(await listOutbox(SITE)).toEqual([]);
    expect(useOffline.getState()).toMatchObject({ pending: 0, rejected: 0 });
  });

  it("while still offline nothing is lost or marked, and the next attempt sends everything", async () => {
    await enqueue(SITE, "request.create", { lines: [] }, "R1");
    const spy = vi.spyOn(http, "post").mockRejectedValueOnce(offlineError());
    expect(await syncNow()).toBe(0);
    expect(useOffline.getState()).toMatchObject({ pending: 1, rejected: 0, syncing: false });
    spy.mockImplementation(((_u: string, body: { ops: { key: string }[] }) => Promise.resolve(syncReply(body.ops.map((o) => ({ key: o.key, status: "applied" }))))) as never);
    expect(await syncNow()).toBe(1);
    expect(await listOutbox(SITE)).toEqual([]);
  });

  it("concurrent syncs share one run (an operation is sent once, not twice)", async () => {
    await enqueue(SITE, "request.create", { lines: [] }, "R1");
    const spy = post((_u, body) => syncReply(body.ops.map((o) => ({ key: o.key, status: "applied" }))));
    const [x, y] = await Promise.all([syncNow(), syncNow()]);
    expect(x).toBe(1);
    expect(y).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends one request per site and batches at 50", async () => {
    for (let i = 0; i < 52; i++) await enqueue(SITE, "request.create", { n: i }, `R${i}`);
    await enqueue(OTHER_SITE, "request.create", {}, "Other site");
    const spy = post((_u, body) => syncReply(body.ops.map((o) => ({ key: o.key, status: "applied" }))));
    expect(await syncNow()).toBe(53);
    const urls = spy.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u === `/sites/${SITE}/sync`)).toHaveLength(2);
    expect(urls.filter((u) => u === `/sites/${OTHER_SITE}/sync`)).toHaveLength(1);
    expect((spy.mock.calls[0]![1] as { ops: unknown[] }).ops).toHaveLength(50);
  });

  it("if access to the site was removed, the saved changes are flagged instead of retried forever", async () => {
    await enqueue(SITE, "request.create", { lines: [] }, "R1");
    vi.spyOn(http, "post").mockRejectedValue(serverError(404, "not_found", "Not found"));
    await syncNow();
    expect((await listOutbox(SITE))[0]).toMatchObject({ state: "rejected", code: "forbidden" });
  });

  it("a queue belongs to its user: another account on the same device neither sees nor sends it", async () => {
    await enqueue(SITE, "request.create", { lines: [] }, "R1");
    user = "user-2";
    const spy = post((_u, body) => syncReply(body.ops.map((o) => ({ key: o.key, status: "applied" }))));
    expect(await listOutbox(SITE)).toEqual([]);
    expect(await syncNow()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    await refreshCounts();
    expect(useOffline.getState().pending).toBe(0);
  });

  it("clearing on sign-out removes unsent work too", async () => {
    await enqueue(SITE, "request.create", { lines: [] }, "R1");
    await clearOffline();
    expect(await listOutbox(SITE)).toEqual([]);
    expect(useOffline.getState().pending).toBe(0);
  });

  it("does nothing when nobody is signed in", async () => {
    setUserIdProvider(() => null);
    expect(await enqueue(SITE, "request.create", {}, "x")).toBeNull();
    expect(await syncNow()).toBe(0);
  });
});

describe("what the user sees", () => {
  it("the banner explains offline mode, the queue, syncing and refused changes", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    useOffline.setState({ pending: 2, rejected: 1, syncing: false, staleSince: "2026-01-01T10:00:00.000Z" });
    const { rerender } = render(<OfflineBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("You are offline");
    expect(banner).toHaveTextContent("2 changes are saved on this device");
    expect(banner).toHaveTextContent("Showing data saved on this device");
    expect(banner).toHaveTextContent("1 saved change was not accepted");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => void window.dispatchEvent(new Event("online")));
    useOffline.setState({ pending: 2, rejected: 0, syncing: true });
    rerender(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Syncing 2 saved changes");
    useOffline.setState({ pending: 0, rejected: 0, syncing: false });
    rerender(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("PendingOps lists waiting and refused items and lets the user retry or dismiss", async () => {
    const a = await enqueue(SITE, "request.create", {}, "Request for BRG-6204");
    const b = await enqueue(SITE, "request.create", {}, "Request for NOPE");
    await (await import("../src/lib/offline/store")).getStore().updateOutbox(b!.id, { state: "rejected", reason: "Item not found" });
    await refreshCounts();
    render(<PendingOps siteId={SITE} types={["request.create"]} />);
    expect(await screen.findByText("Request for BRG-6204")).toBeInTheDocument();
    expect(screen.getByText("Waiting to send")).toBeInTheDocument();
    expect(screen.getByText("Item not found")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss: Request for NOPE" }));
    await waitFor(() => expect(screen.queryByText("Request for NOPE")).not.toBeInTheDocument());
    expect(screen.getByText("Request for BRG-6204")).toBeInTheDocument();
    expect(a).not.toBeNull();
  });

  it("PendingOps shows nothing for other sites or other kinds of change", async () => {
    await enqueue(OTHER_SITE, "request.create", {}, "elsewhere");
    await enqueue(SITE, "consumption.record", {}, "consumption");
    const { container } = render(<PendingOps siteId={SITE} types={["request.create"]} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("screens", () => {
  const cfg = configs.distribution;
  const assignment: Assignment = { id: "aaaaaaaa-0000-4000-8000-000000000001", siteId: cfg.siteId, requestId: "bbbbbbbb-0000-4000-8000-000000000001", quantity: 4, configVersion: 1, lines: [], assignedBy: "u", createdAt: "2026-01-01T10:00:00.000Z" };
  const runtime = (permissions: string[]) => ({ siteId: cfg.siteId, slug: cfg.slug, version: 1, config: cfg, permissions: new Set(permissions), preview: false, basePath: `/s/${cfg.slug}`, reload: () => undefined });
  const page = { id: "p", title: "Consumption", path: "consumption", nodeId: "n", layoutId: "l" };
  const node = { id: "n", moduleType: "consumption-tracking", position: { x: 0, y: 0 }, config: {} } as never;
  const session: AuthSession = { user: { id: "user-1", email: "a@b.c", displayName: "A", isPlatformAdmin: false }, memberships: [], expiresAt: "2030-01-01T00:00:00.000Z" };

  it("consumption recorded while offline is saved on the device (not lost, not an error)", async () => {
    useSession.setState({ status: "authenticated", session });
    vi.mocked(opsApi.assignments).mockResolvedValue([assignment]);
    vi.spyOn(http, "post").mockRejectedValue(offlineError());
    render(
      <MemoryRouter>
        <SiteRuntimeProvider value={runtime(["consumption:record"])}>
          <ConsumptionModule page={page} node={node} layout={undefined as never} />
        </SiteRuntimeProvider>
      </MemoryRouter>,
    );
    await userEvent.type(await screen.findByLabelText(/Quantity consumed/), "2");
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByText("Consumption of 2 on assignment #aaaaaaaa")).toBeInTheDocument();
    const [saved] = await listOutbox(cfg.siteId);
    expect(saved).toMatchObject({ type: "consumption.record", state: "pending", payload: { assignmentId: assignment.id, quantity: 2 } });
    expect(screen.getByText("Waiting to send")).toBeInTheDocument();
  });

  it("a real server refusal is shown as an error and is not queued", async () => {
    vi.mocked(opsApi.assignments).mockResolvedValue([assignment]);
    vi.spyOn(http, "post").mockRejectedValue(serverError(409, "over_consumption", "Only 1 unit(s) remain unconsumed on this assignment"));
    render(
      <MemoryRouter>
        <SiteRuntimeProvider value={runtime(["consumption:record"])}>
          <ConsumptionModule page={page} node={node} layout={undefined as never} />
        </SiteRuntimeProvider>
      </MemoryRouter>,
    );
    await userEvent.type(await screen.findByLabelText(/Quantity consumed/), "9");
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(http.post).toHaveBeenCalled());
    expect(await listOutbox(cfg.siteId)).toEqual([]);
  });

  it("assigning stock is switched off while offline, with the reason on screen", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    vi.mocked(opsApi.requests).mockResolvedValue({ items: [{ id: "cccccccc-0000-4000-8000-000000000001", siteId: cfg.siteId, lines: [{ id: "l", itemId: "i", sku: "S", name: "N", quantity: 1, extras: {} }], status: "approved", requestedBy: "u", releaseVersion: 1, createdAt: "2026-01-01T10:00:00.000Z", statusChangedAt: "2026-01-01T10:00:00.000Z", ageSeconds: 0 }], page: 1, pageSize: 100, total: 1 });
    vi.mocked(opsApi.assignments).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SiteRuntimeProvider value={runtime(["assignment:create", "assignment:view"])}>
          <AssignmentsModule page={page} node={node} layout={undefined as never} />
        </SiteRuntimeProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /Assign stock for request/ })).toBeDisabled();
    expect(screen.getByText(/Assigning stock changes quantities/)).toBeInTheDocument();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("an ApiRequestError with status 0 is what the screens treat as 'offline'", () => {
    expect(new ApiRequestError(0, "network", "x").status).toBe(0);
  });
});
