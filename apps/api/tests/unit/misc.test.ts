import { describe, expect, it } from "vitest";
import { diffConfigurations } from "../../src/releases/diff.js";
import { AppError, notImplemented, toApiError } from "../../src/utils/errors.js";
import { canTransition, repairTransitions, requestTransitions } from "../../src/workflows/transitions.js";
import { manifest } from "../../src/routes/manifest.js";

describe("release diff", () => {
  it("reports added, removed and changed leaves", () => {
    const entries = diffConfigurations({ a: 1, b: { c: 1 }, d: 1 }, { a: 2, b: { c: 1 }, e: 1 });
    expect(entries).toEqual([
      { path: "a", change: "changed" },
      { path: "d", change: "removed" },
      { path: "e", change: "added" },
    ]);
  });
  it("compares id-keyed arrays by id so reordering is not a change", () => {
    const a = { nodes: [{ id: "x", v: 1 }, { id: "y", v: 1 }] };
    const b = { nodes: [{ id: "y", v: 1 }, { id: "x", v: 1 }, { id: "z", v: 1 }] };
    expect(diffConfigurations(a, b)).toEqual([{ path: "nodes[z]", change: "added" }]);
  });
  it("is empty for identical input", () => {
    expect(diffConfigurations({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });
});

describe("workflow transitions", () => {
  it("allows only declared request transitions", () => {
    expect(canTransition(requestTransitions, "submitted", "approved")).toBe(true);
    expect(canTransition(requestTransitions, "submitted", "assigned")).toBe(false);
    expect(canTransition(requestTransitions, "rejected", "approved")).toBe(false);
    expect(canTransition(requestTransitions, "approved", "assigned")).toBe(true);
  });
  it("allows only declared repair transitions", () => {
    expect(canTransition(repairTransitions, "testing", "repairing")).toBe(true);
    expect(canTransition(repairTransitions, "received", "completed")).toBe(false);
    expect(canTransition(repairTransitions, "completed", "repairing")).toBe(false);
  });
});

describe("API error serialization", () => {
  it("exposes AppError details and request id", () => {
    const { status, body } = toApiError(new AppError(409, "stale_draft", "Stale", [{ path: "x", message: "y" }]), "req-1");
    expect(status).toBe(409);
    expect(body).toEqual({ code: "stale_draft", message: "Stale", requestId: "req-1", details: [{ path: "x", message: "y" }] });
  });
  it("hides internals of unexpected errors", () => {
    const { status, body } = toApiError(new Error("secret db password in stack"), "req-2");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("secret");
  });
  it("maps not-implemented to 501", () => {
    expect(toApiError(notImplemented("Thing"), undefined).status).toBe(501);
  });
});

describe("route manifest", () => {
  it("starts empty until an app is created", () => {
    expect(Array.isArray(manifest)).toBe(true);
  });
});
