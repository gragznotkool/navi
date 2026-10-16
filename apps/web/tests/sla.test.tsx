import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlaRing } from "../src/components/SlaRing";
import { approvalSlaSeconds, formatDuration, liveAge, slaState } from "../src/lib/sla";
import { configs } from "./helpers";

describe("slaState", () => {
  it("only a submitted request can breach", () => {
    for (const status of ["approved", "assigned", "fulfilled", "rejected"]) expect(slaState(status, 9999, 10)).toBeNull();
    expect(slaState("submitted", 9999, 10)?.tone).toBe("breached");
  });
  it("shows nothing when no deadline is configured", () => {
    expect(slaState("submitted", 50, null)).toBeNull();
  });
  it("is ok, then warning in the last 30%, then breached at the deadline", () => {
    expect(slaState("submitted", 2, 10)).toMatchObject({ tone: "ok", label: "8s left" });
    expect(slaState("submitted", 7, 10)).toMatchObject({ tone: "warning", label: "3s left" });
    expect(slaState("submitted", 10, 10)).toMatchObject({ tone: "breached", label: "Overdue by 0s", fraction: 0 });
    expect(slaState("submitted", 25, 10)).toMatchObject({ tone: "breached", label: "Overdue by 15s" });
  });
  it("formats long durations", () => {
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDuration(3 * 3600 + 120)).toBe("3h 2m");
    expect(formatDuration(2 * 86400 + 3600)).toBe("2d 1h");
  });
  it("liveAge adds only elapsed local time to the server's age (a wrong device clock cannot skew it)", () => {
    expect(liveAge(4, 1_000, 3_500)).toBe(6.5);
    expect(liveAge(4, 5_000, 1_000)).toBe(4); // clock moved backwards: never negative elapsed time
  });
  it("reads slaSeconds from the Approval node", () => {
    expect(approvalSlaSeconds(configs.central)).toBeNull();
    const cfg = JSON.parse(JSON.stringify(configs.distribution)) as typeof configs.distribution;
    const node = cfg.modules.nodes.find((n) => n.moduleType === "approval")!;
    node.config = { slaSeconds: 10 };
    expect(approvalSlaSeconds(cfg)).toBe(10);
    node.config = { slaSeconds: -3 };
    expect(approvalSlaSeconds(cfg)).toBeNull();
    node.config = { slaSeconds: "10" };
    expect(approvalSlaSeconds(cfg)).toBeNull();
  });
});

describe("SlaRing countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const mount = (status = "submitted", age = 0) => render(<SlaRing status={status} ageSeconds={age} receivedAt={Date.now()} slaSeconds={10} />);

  it("counts down every second without a refresh and turns red at the deadline", () => {
    const { container } = mount();
    const ring = () => container.querySelector("[data-sla]")!;
    expect(screen.getByText("10s left")).toBeInTheDocument();
    expect(ring()).toHaveAttribute("data-sla", "ok");

    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByText("7s left")).toBeInTheDocument();
    expect(ring()).toHaveAttribute("data-sla", "ok");

    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText("2s left")).toBeInTheDocument();
    expect(ring()).toHaveAttribute("data-sla", "warning");

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Overdue by 0s")).toBeInTheDocument();
    expect(ring()).toHaveAttribute("data-sla", "breached");
    expect(ring().className).toContain("text-red-700");

    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText("Overdue by 5s")).toBeInTheDocument();
  });

  it("starts from the server's age, not from zero", () => {
    mount("submitted", 8);
    expect(screen.getByText("2s left")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Overdue by 0s")).toBeInTheDocument();
  });

  it("conveys state with text as well as color, and renders nothing for decided requests", () => {
    const { container, unmount } = mount("approved", 100);
    expect(container).toBeEmptyDOMElement();
    unmount();
    mount("submitted", 100);
    expect(screen.getByText(/Overdue by/)).toBeInTheDocument();
  });

  it("stops its shared timer when unmounted", () => {
    const { unmount } = mount();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
