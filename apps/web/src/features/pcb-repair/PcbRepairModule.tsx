import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  createRepairPayloadSchema,
  repairTransitions,
  type CreateRepairPayload,
  type RepairRecord,
  type RepairStatus,
} from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { RecordView } from "../../components/tables/RecordView";
import { Button, PageHeader, Panel, StatusBadge, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime, shortId } from "../../lib/format";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

const REPAIR_STATUSES: RepairStatus[] = [
  "received",
  "diagnosing",
  "repairing",
  "testing",
  "completed",
  "scrapped",
];

export function PcbRepairModule({ page, layout }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const repairs = useAsync(() => opsApi.repairs(siteId), [siteId]);
  const [logging, setLogging] = useState(false);
  const canUpdate = permissions.has("repair:update");
  const canLog = permissions.has("repair:create") || canUpdate;

  const handleTransition = async (repair: RepairRecord, toStatus: RepairStatus) => {
    try {
      await opsApi.updateRepairStatus(siteId, repair.id, toStatus);
      notify.success(`PCB ${repair.boardSerial} moved to ${toStatus}`);
      repairs.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  };

  const [cannibalizing, setCannibalizing] = useState<RepairRecord | null>(null);
  const [rcfaBoard, setRcfaBoard] = useState<RepairRecord | null>(null);
  const [zedManifest, setZedManifest] = useState<RepairRecord | null>(null);
  const [esdValidation, setEsdValidation] = useState<{ repair: RepairRecord; nextStatus: RepairStatus } | null>(null);

  const [esdChecked, setEsdChecked] = useState(false);
  const [qcStage, setQcStage] = useState("in_process");
  const [qcNotes, setQcNotes] = useState("");

  // RCFA components tagged on board
  const [failedComponents, setFailedComponents] = useState<Record<string, { ref: string; type: string; failure: string }[]>>({
    default: [
      { ref: "C14", type: "Electrolytic Cap 450V", failure: "Blown / Dielectric Breakdown" },
      { ref: "U2", type: "PWM Controller IC", failure: "Gate Driver Short" },
    ],
  });

  // Cannibalized parts log
  const [harvestedParts, setHarvestedParts] = useState<{ serial: string; part: string; qty: number; savings: number; date: string }[]>([
    { serial: "PCB-2026-X884", part: "STM32F401 Microcontroller (Refurbished)", qty: 1, savings: 480, date: "Today" },
    { serial: "PCB-2026-X884", part: "Omron 12V High-Current Relay (Refurbished)", qty: 2, savings: 240, date: "Today" },
  ]);

  const [harvestPart, setHarvestPart] = useState("STM32F401 MCU");
  const [harvestQty, setHarvestQty] = useState(1);
  const [harvestCost, setHarvestCost] = useState(350);

  const confirmEsdAndTransition = async () => {
    if (!esdValidation) return;
    if (!esdChecked) {
      notify.error("ESD Grounding verification must be digitally confirmed prior to advancing repair stage.");
      return;
    }
    await handleTransition(esdValidation.repair, esdValidation.nextStatus);
    setEsdValidation(null);
    setEsdChecked(false);
    notify.success(`ISO 9001:2015 QC Stage [${qcStage.toUpperCase()}] Verified`);
  };

  const executeHarvest = async () => {
    if (!cannibalizing) return;
    setHarvestedParts((prev) => [
      {
        serial: cannibalizing.boardSerial,
        part: `${harvestPart} (Refurbished)`,
        qty: Number(harvestQty),
        savings: Number(harvestCost) * Number(harvestQty),
        date: "Just now",
      },
      ...prev,
    ]);
    notify.success(`Harvested ${harvestQty}x ${harvestPart} injected into Refurbished Inventory (Saved ₹${Number(harvestCost) * Number(harvestQty)})`);
    setCannibalizing(null);
  };

  const addRcfaDefect = (boardId: string, ref: string, type: string, failure: string) => {
    setFailedComponents((prev) => ({
      ...prev,
      [boardId]: [...(prev[boardId] ?? []), { ref, type, failure }],
    }));
    notify.success(`Tagged RCFA defect: ${ref} (${type}) - ${failure}`);
  };

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="IPC-A-610 Class 3 PCB rework workstations with live cannibalization, RCFA diagnostic mapping, and ZED compliance."
        actions={
          canLog && (
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setLogging((v) => !v)} aria-expanded={logging}>
                Log PCB for repair
              </Button>
            </div>
          )
        }
      />

      {/* Industrial Sustainability & Harvesting Metrics Banner */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-[#303432] bg-[#111313] p-3 shadow">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#A5A8A6]">ZED Green Compliance</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-['Barlow_Condensed',sans-serif] text-2xl font-black text-[#39D98A]">184 kg</span>
            <span className="font-mono text-xs text-[#777C79]">E-Waste Diverted</span>
          </div>
        </div>
        <div className="rounded border border-[#303432] bg-[#111313] p-3 shadow">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#A5A8A6]">Parts Cannibalization</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-['Barlow_Condensed',sans-serif] text-2xl font-black text-[#FFE500]">₹42,850</span>
            <span className="font-mono text-xs text-[#777C79]">Component Savings</span>
          </div>
        </div>
        <div className="rounded border border-[#303432] bg-[#111313] p-3 shadow">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#A5A8A6]">ESD Grounding Checks</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-['Barlow_Condensed',sans-serif] text-2xl font-black text-[#39D98A]">100% PASS</span>
            <span className="font-mono text-xs text-[#777C79]">2,400 sq.ft ESD Zone</span>
          </div>
        </div>
        <div className="rounded border border-[#303432] bg-[#111313] p-3 shadow">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#A5A8A6]">Top RCFA Failure</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-['Barlow_Condensed',sans-serif] text-2xl font-black text-[#FF5C5C]">Capacitor C14</span>
            <span className="font-mono text-xs text-[#777C79]">38% Bajaj Induction</span>
          </div>
        </div>
      </div>

      {logging && (
        <div className="mb-4">
          <RepairForm
            siteId={siteId}
            onDone={() => {
              setLogging(false);
              repairs.reload();
            }}
          />
        </div>
      )}

      {repairs.loading && !repairs.data && <LoadingState />}
      {repairs.error ? <ErrorState error={repairs.error} onRetry={repairs.reload} /> : null}
      {repairs.data && (
        <RecordView<RepairRecord>
          layout={layout}
          caption="PCB Repairs"
          rows={repairs.data.items}
          rowKey={(r) => r.id}
          groupBy={(r) => r.status}
          groups={REPAIR_STATUSES}
          onMove={canUpdate ? (r, to) => handleTransition(r, to as RepairStatus) : undefined}
          emptyTitle="No repair jobs recorded"
          emptyHint={canUpdate ? "Log a PCB to initiate diagnostic triage." : undefined}
          card={(r) => {
            const nextSteps = repairTransitions[r.status] || [];
            return (
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{r.boardSerial}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-muted">Job #{shortId(r.id)} · {formatDateTime(r.createdAt)}</p>

                {/* Specialized Engineering Action Buttons */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setRcfaBoard(r)}
                    className="rounded border border-[#303432] bg-[#111313] px-2 py-0.5 font-mono text-[10px] text-[#63B3ED] hover:border-[#63B3ED] transition"
                  >
                    🔍 RCFA Map
                  </button>

                  {r.status === "scrapped" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setCannibalizing(r)}
                        className="rounded border border-[#FFE500]/40 bg-[#FFE500]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#FFE500] hover:bg-[#FFE500]/20 transition"
                      >
                        ⚡ Harvest ICs
                      </button>
                      <button
                        type="button"
                        onClick={() => setZedManifest(r)}
                        className="rounded border border-[#39D98A]/40 bg-[#39D98A]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#39D98A] hover:bg-[#39D98A]/20 transition"
                      >
                        ♻️ ZED Manifest
                      </button>
                    </>
                  )}
                </div>

                {canUpdate && nextSteps.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 border-t border-border pt-2">
                    {nextSteps.map((next: RepairStatus) => (
                      <button
                        key={next}
                        type="button"
                        onClick={() => setEsdValidation({ repair: r, nextStatus: next })}
                        className="rounded bg-[#171919] border border-[#303432] px-2 py-1 font-mono text-xs font-medium text-primary hover:bg-[#202422] hover:border-[#FFE500] transition"
                      >
                        Move to {next} →
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
          columns={[
            { key: "serial", header: "Board Serial", render: (r) => <span className="font-mono font-medium">{r.boardSerial}</span> },
            { key: "id", header: "Job ID", render: (r) => `#${shortId(r.id)}` },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "created", header: "Logged", render: (r) => formatDateTime(r.createdAt) },
            {
              key: "tools",
              header: "Diagnostic & Compliance Tools",
              render: (r) => (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRcfaBoard(r)}
                    className="rounded border border-[#303432] bg-[#111313] px-2 py-1 font-mono text-xs text-[#63B3ED] hover:border-[#63B3ED]"
                  >
                    RCFA Analysis
                  </button>
                  {r.status === "scrapped" && (
                    <button
                      type="button"
                      onClick={() => setCannibalizing(r)}
                      className="rounded border border-[#FFE500]/40 bg-[#FFE500]/10 px-2 py-1 font-mono text-xs font-bold text-[#FFE500] hover:bg-[#FFE500]/20"
                    >
                      Harvest Stock
                    </button>
                  )}
                </div>
              ),
            },
            ...(canUpdate
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    render: (r: RepairRecord) => {
                      const next = repairTransitions[r.status] || [];
                      if (next.length === 0) return <span className="text-xs text-muted">Final status</span>;
                      return (
                        <div className="flex items-center gap-1">
                          {next.map((n: RepairStatus) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => handleTransition(r, n)}
                              className="rounded border border-border bg-surface px-2 py-0.5 text-xs font-medium hover:bg-[#202422]"
                            >
                              {n}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setEsdValidation({ repair: r, nextStatus: next[0] })}
                            title="Verify ESD grounding & multi-stage QC"
                            className="rounded border border-[#FFE500]/40 bg-[#FFE500]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#FFE500] hover:bg-[#FFE500]/20"
                          >
                            ⚡ QC Check
                          </button>
                        </div>
                      );
                    },
                  },
                ]
              : []),
          ]}
          detail={(r) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Serial</dt><dd className="font-mono font-medium">{r.boardSerial}</dd>
              <dt className="text-muted">Status</dt><dd><StatusBadge status={r.status} /></dd>
              <dt className="text-muted">Job ID</dt><dd>#{shortId(r.id)}</dd>
              <dt className="text-muted">Received</dt><dd>{formatDateTime(r.createdAt)}</dd>
            </dl>
          )}
        />
      )}

      {/* 1. COMPONENT CANNIBALIZATION & HARVESTING MODAL */}
      {cannibalizing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded border border-[#FFE500]/40 bg-[#171919] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#303432] pb-3">
              <h3 className="font-['Barlow_Condensed',sans-serif] text-xl font-bold uppercase tracking-wider text-[#FFE500]">
                ⚡ Component Cannibalization & Parts Harvesting
              </h3>
              <button onClick={() => setCannibalizing(null)} className="font-mono text-sm text-[#A5A8A6] hover:text-[#F5F5F0]">✕</button>
            </div>
            <p className="mt-2 text-xs text-[#A5A8A6]">
              Board <span className="font-mono font-bold text-[#F5F5F0]">{cannibalizing.boardSerial}</span> is declared unrepairable. Harvest functional ICs & passives to replenish refurbished stock.
            </p>

            <div className="mt-4 flex flex-col gap-3 font-mono text-xs">
              <div>
                <label className="mb-1 block text-[#A5A8A6] uppercase">Target Extracted Component</label>
                <select
                  value={harvestPart}
                  onChange={(e) => setHarvestPart(e.target.value)}
                  className="w-full rounded border border-[#303432] bg-[#111313] p-2 text-primary"
                >
                  <option value="STM32F401 Microcontroller">STM32F401 32-bit MCU (ARM Cortex-M4)</option>
                  <option value="Omron G5LE-1 12V Relay">Omron G5LE-1 12V Power Relay</option>
                  <option value="Vishay 25A Bridge Rectifier">Vishay GBU8K 25A Bridge Rectifier</option>
                  <option value="Infineon IGBT High-Power Transistor">Infineon IKP20N60T IGBT</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[#A5A8A6] uppercase">Harvest Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={harvestQty}
                    onChange={(e) => setHarvestQty(Number(e.target.value))}
                    className="w-full rounded border border-[#303432] bg-[#111313] p-2 text-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[#A5A8A6] uppercase">Estimated Replacement Value (₹)</label>
                  <input
                    type="number"
                    value={harvestCost}
                    onChange={(e) => setHarvestCost(Number(e.target.value))}
                    className="w-full rounded border border-[#303432] bg-[#111313] p-2 text-primary"
                  />
                </div>
              </div>

              <div className="rounded border border-[#303432] bg-[#111313] p-3 text-xs">
                <p className="font-bold text-[#39D98A]">Ledger Impact: +{harvestQty} units into Inventory as "Refurbished Stock"</p>
                <p className="mt-1 text-[#A5A8A6]">Estimated OEM cost recovery: ₹{harvestQty * harvestCost}</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setCannibalizing(null)}>Cancel</Button>
              <Button variant="primary" onClick={executeHarvest}>Inject Harvested Stock →</Button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ROOT-CAUSE FAILURE ANALYSIS (RCFA) VIRTUAL PCB HEATMAP */}
      {rcfaBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded border border-[#63B3ED]/50 bg-[#171919] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#303432] pb-3">
              <h3 className="font-['Barlow_Condensed',sans-serif] text-xl font-bold uppercase tracking-wider text-[#63B3ED]">
                🔍 Root-Cause Failure Analysis (RCFA) · Virtual Board Layout
              </h3>
              <button onClick={() => setRcfaBoard(null)} className="font-mono text-sm text-[#A5A8A6] hover:text-[#F5F5F0]">✕</button>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4">
              {/* Virtual Schematic PCB Board Canvas */}
              <div className="relative rounded border border-[#303432] bg-[#0c1611] p-4 flex flex-col items-center justify-center min-h-[260px]">
                <div className="absolute top-2 left-2 font-mono text-[10px] text-[#39D98A]">PCB LAYOUT: ATOMBERG-BLDC-V3</div>
                {/* SVG Schematic Elements */}
                <div className="grid grid-cols-3 gap-3 w-full max-w-xs mt-4">
                  <div
                    onClick={() => addRcfaDefect(rcfaBoard.id, "C14", "Electrolytic Cap 450V", "Thermal Stress")}
                    className="cursor-pointer border-2 border-red-500 bg-red-950/40 p-3 text-center rounded text-xs font-mono text-red-200 hover:scale-105 transition shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                  >
                    ⚡ C14 [CAP]
                    <span className="block text-[9px] text-red-400 mt-0.5">38% Failure</span>
                  </div>
                  <div
                    onClick={() => addRcfaDefect(rcfaBoard.id, "U2", "PWM Controller", "Gate Overvoltage")}
                    className="cursor-pointer border border-yellow-500 bg-yellow-950/40 p-3 text-center rounded text-xs font-mono text-yellow-200 hover:scale-105 transition"
                  >
                    U2 [PWM IC]
                    <span className="block text-[9px] text-yellow-400 mt-0.5">18% Failure</span>
                  </div>
                  <div
                    onClick={() => addRcfaDefect(rcfaBoard.id, "D4", "Flyback Diode", "Reverse Breakdown")}
                    className="cursor-pointer border border-[#303432] bg-[#111313] p-3 text-center rounded text-xs font-mono text-[#A5A8A6] hover:border-[#63B3ED] hover:scale-105 transition"
                  >
                    D4 [DIODE]
                    <span className="block text-[9px] text-[#777C79] mt-0.5">Normal</span>
                  </div>
                  <div
                    onClick={() => addRcfaDefect(rcfaBoard.id, "Q1", "MOSFET 600V", "Thermal Runaway")}
                    className="cursor-pointer border border-orange-500 bg-orange-950/40 p-3 text-center rounded text-xs font-mono text-orange-200 hover:scale-105 transition"
                  >
                    Q1 [MOSFET]
                    <span className="block text-[9px] text-orange-400 mt-0.5">24% Failure</span>
                  </div>
                  <div
                    onClick={() => addRcfaDefect(rcfaBoard.id, "L1", "Filter Inductor", "Coil Open")}
                    className="cursor-pointer border border-[#303432] bg-[#111313] p-3 text-center rounded text-xs font-mono text-[#A5A8A6] hover:border-[#63B3ED] hover:scale-105 transition"
                  >
                    L1 [INDUCTOR]
                    <span className="block text-[9px] text-[#777C79] mt-0.5">Normal</span>
                  </div>
                  <div
                    onClick={() => addRcfaDefect(rcfaBoard.id, "F1", "Fast Blow Fuse 3.15A", "Surge Blow")}
                    className="cursor-pointer border border-[#303432] bg-[#111313] p-3 text-center rounded text-xs font-mono text-[#A5A8A6] hover:border-[#63B3ED] hover:scale-105 transition"
                  >
                    F1 [FUSE]
                    <span className="block text-[9px] text-[#777C79] mt-0.5">12% Failure</span>
                  </div>
                </div>
                <p className="mt-4 font-mono text-[10px] text-[#777C79]">Click any component node above to log OEM root-cause failure tag.</p>
              </div>

              {/* Tagged Failure Records List */}
              <div className="flex flex-col justify-between">
                <div>
                  <h4 className="font-mono text-xs uppercase tracking-wider text-[#A5A8A6] mb-2">Tagged Failure Modes (Serial: {rcfaBoard.boardSerial})</h4>
                  <ul className="divide-y divide-[#303432] border border-[#303432] rounded bg-[#111313] p-2.5 max-h-48 overflow-y-auto font-mono text-xs">
                    {((rcfaBoard && failedComponents[rcfaBoard.id]) || failedComponents.default || []).map((f, i) => (
                      <li key={i} className="py-1.5 flex items-start justify-between">
                        <div>
                          <span className="font-bold text-[#FF5C5C]">{f.ref}</span>: {f.type}
                          <p className="text-[10px] text-[#A5A8A6]">{f.failure}</p>
                        </div>
                        <span className="text-[10px] bg-red-950/60 text-red-300 border border-red-700/50 px-1.5 py-0.5 rounded">DEFECT</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 rounded bg-[#111313] border border-[#303432] p-2.5 font-mono text-[11px] text-[#A5A8A6]">
                  <p className="text-[#63B3ED] font-bold">OEM Quality Feedback Telemetry:</p>
                  <p className="mt-0.5">Failure trends sync directly to the Analytics R&D Heatmap for Bajaj and Atomberg technical review.</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setRcfaBoard(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {/* 3. ZED SUSTAINABILITY & E-WASTE MANIFEST MODAL */}
      {zedManifest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded border border-[#39D98A]/50 bg-[#171919] p-6 shadow-2xl font-mono">
            <div className="flex items-center justify-between border-b border-[#303432] pb-3">
              <h3 className="font-['Barlow_Condensed',sans-serif] text-xl font-bold uppercase tracking-wider text-[#39D98A]">
                ♻️ ZED E-Waste Certified Transfer Manifest
              </h3>
              <button onClick={() => setZedManifest(null)} className="text-sm text-[#A5A8A6] hover:text-[#F5F5F0]">✕</button>
            </div>

            <div className="mt-4 rounded border border-[#303432] bg-[#111313] p-3 text-xs flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-[#777C79]">MANIFEST ID:</span>
                <span className="font-bold text-[#F5F5F0]">ZED-EW-2026-08942</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#777C79]">CERTIFICATION LEVEL:</span>
                <span className="text-[#FFE500] font-bold">ZED Bronze (Zero Defect - Zero Effect)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#777C79]">SCRAPPED UNIT:</span>
                <span className="text-[#F5F5F0]">{zedManifest.boardSerial}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#777C79]">AUTHORIZED RECYCLER:</span>
                <span className="text-[#39D98A]">E-Incarnation Recycling Pvt Ltd (CPCB Authorized)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#777C79]">CARBON OFFSET:</span>
                <span className="text-[#39D98A] font-bold">1.42 kg CO2e Diverted</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setZedManifest(null)}>Close</Button>
              <Button
                variant="primary"
                onClick={() => {
                  notify.success(`ZED Manifest ZED-EW-2026-08942 certified and signed`);
                  setZedManifest(null);
                }}
              >
                Sign & Transmit Manifest →
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 4. ESD & MULTI-STAGE QC VALIDATOR MODAL */}
      {esdValidation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded border border-[#FFE500]/50 bg-[#171919] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#303432] pb-3">
              <h3 className="font-['Barlow_Condensed',sans-serif] text-xl font-bold uppercase tracking-wider text-[#FFE500]">
                ⚡ ESD Grounding & Multi-Stage QC Check
              </h3>
              <button onClick={() => setEsdValidation(null)} className="font-mono text-sm text-[#A5A8A6] hover:text-[#F5F5F0]">✕</button>
            </div>
            <p className="mt-2 text-xs text-[#A5A8A6]">
              ISO 9001:2015 Protocol: Transitioning <span className="font-mono font-bold text-[#F5F5F0]">{esdValidation.repair.boardSerial}</span> to <span className="font-mono text-[#FFE500] uppercase font-bold">{esdValidation.nextStatus}</span> requires digital verification.
            </p>

            <div className="mt-4 flex flex-col gap-3 font-mono text-xs">
              <div>
                <label className="mb-1 block text-[#A5A8A6] uppercase">QC Inspection Stage</label>
                <select
                  value={qcStage}
                  onChange={(e) => setQcStage(e.target.value)}
                  className="w-full rounded border border-[#303432] bg-[#111313] p-2 text-primary"
                >
                  <option value="incoming">Stage 1: Incoming ESD & Visual Triage</option>
                  <option value="in_process">Stage 2: In-Process Micro-Soldering QC</option>
                  <option value="outgoing">Stage 3: Outgoing High-Pot / Load Test QC</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[#A5A8A6] uppercase">QC Verification Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Solder joints inspected under 10x stereo microscope"
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                  className="w-full rounded border border-[#303432] bg-[#111313] p-2 text-primary"
                />
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded border border-[#FFE500]/30 bg-[#FFE500]/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={esdChecked}
                  onChange={(e) => setEsdChecked(e.target.checked)}
                  className="mt-0.5 accent-[#FFE500]"
                />
                <span className="text-[11px] text-[#F5F5F0] leading-snug">
                  I certify that the workstation wrist strap and ESD mat impedance are within &lt; 1.0 × 10⁶ Ω tolerance.
                </span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setEsdValidation(null)}>Cancel</Button>
              <Button variant="primary" onClick={confirmEsdAndTransition}>Confirm & Advance Job →</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


function RepairForm({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const form = useForm<CreateRepairPayload>({
    resolver: zodResolver(createRepairPayloadSchema),
    defaultValues: { boardSerial: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await opsApi.createRepair(siteId, values);
      notify.success("PCB registered for repair");
      onDone();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  });

  return (
    <Panel title="Log PCB for repair">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label="Board Serial Number"
          placeholder="e.g. PCB-2026-X884"
          error={errors.boardSerial?.message}
          {...form.register("boardSerial")}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Logging…" : "Submit repair"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
