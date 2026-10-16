import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, Position, ReactFlow, applyEdgeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { Redo2, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ConfigurationValidationResult, ModuleDefinition, SiteConfiguration } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, PageHeader, Panel, SelectField, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import { configApi, releasesApi, sitesApi } from "../../services";
import { notify } from "../../stores/toast";
import { addEdge, addModule, edgeIdOf, explainConnection, isolationProblem, moveNode, removeEdge } from "./configOps";
import { checkpoint, commit, createHistory, redo, replace, undo } from "./history";
import { Inspector } from "./Inspector";
import { PRESETS, applyPreset, type Preset } from "./presets";
import { usePreviewStore } from "./previewStore";
import { ImpactDialog } from "../releases/ImpactDialog";
import { FieldsPanel } from "./FieldsPanel";

type ModuleNodeData = { def: ModuleDefinition | undefined; moduleType: string; shake: boolean; problem: string | null };

function ModuleNodeView({ data, selected }: NodeProps<Node<ModuleNodeData>>) {
  const def = data.def;
  const inputs = def?.ports.filter((p) => p.direction === "input") ?? [];
  const outputs = def?.ports.filter((p) => p.direction === "output") ?? [];
  const border = data.problem ? "border-danger border-dashed" : selected ? "border-accent ring-2 ring-accent/30" : "border-line";
  return (
    <div className={`w-56 rounded-ui border bg-surface text-xs ${border} ${data.shake ? "ops-shake" : ""}`} data-testid={`node-${data.moduleType}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-semibold text-ink">{def?.displayName ?? data.moduleType}</span>
        {def?.platformModule && <Badge tone="info">platform</Badge>}
      </div>
      <div className="flex justify-between gap-2 px-3 py-2 text-muted">
        <ul>
          {inputs.map((p) => (
            <li key={p.id} className="relative py-0.5">
              <Handle type="target" id={p.id} position={Position.Left} style={{ left: -13 }} />
              {p.label}
            </li>
          ))}
        </ul>
        <ul className="text-right">
          {outputs.map((p) => (
            <li key={p.id} className="relative py-0.5">
              <Handle type="source" id={p.id} position={Position.Right} style={{ right: -13 }} />
              {p.label}
            </li>
          ))}
        </ul>
      </div>
      {data.problem && <p role="status" className="border-t border-dashed border-danger px-3 py-1.5 text-[11px] text-danger">{data.problem}</p>}
    </div>
  );
}

const nodeTypes = { module: ModuleNodeView };
const REJECT_MS = 1500;
const PULSE_MS = 1400;

export function BuilderPage({ activeVersion, activeConfig }: { activeVersion: number; activeConfig: SiteConfiguration }) {
  const { siteId, slug, reload } = useSiteRuntime();
  const navigate = useNavigate();
  const setPreview = usePreviewStore((s) => s.setDraft);
  const registry = useAsync(async () => ({ modules: await sitesApi.modules(), dataTypes: await sitesApi.dataTypes() }), []);

  // Working config lives in an undo/redo history; server verdict, selection and release state are separate.
  const [hist, setHist] = useState(() => createHistory(activeConfig));
  const config = hist.present;
  const [validation, setValidation] = useState<ConfigurationValidationResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"validate" | "draft" | "preview" | "publish" | null>(null);
  const [stale, setStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(activeConfig), [config, activeConfig]);

  // Visual feedback state: valid-edge pulses, rejected "ghost" edges and shaking nodes.
  const [pulsing, setPulsing] = useState<ReadonlySet<string>>(new Set());
  const [ghosts, setGhosts] = useState<Edge[]>([]);
  const [shaking, setShaking] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const flow = useRef<ReactFlowInstance<Node<ModuleNodeData>, Edge> | null>(null);

  const edit = useCallback((next: SiteConfiguration) => {
    setHist((h) => commit(h, next));
    setValidation(null); // any edit invalidates the previous server verdict
  }, []);
  const doUndo = useCallback(() => { setHist(undo); setValidation(null); }, []);
  const doRedo = useCallback(() => { setHist(redo); setValidation(null); }, []);

  useEffect(() => {
    let active = true;
    configApi.draft(siteId).then((d) => {
      if (!active || !d || !d.configuration) return;
      if (d.baseVersion === activeVersion) {
        setHist(createHistory(d.configuration));
        notify.info("Restored saved draft");
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [siteId, activeVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const timed = <T,>(set: (fn: (prev: T) => T) => void, add: (prev: T) => T, remove: (prev: T) => T, ms: number) => {
    set(add);
    setTimeout(() => set(remove), ms);
  };
  const shake = (nodeId: string) =>
    timed<ReadonlySet<string>>(setShaking, (s) => new Set(s).add(nodeId), (s) => { const n = new Set(s); n.delete(nodeId); return n; }, 600);
  const pulse = (ids: string[]) =>
    timed<ReadonlySet<string>>(setPulsing, (s) => new Set([...s, ...ids]), (s) => new Set([...s].filter((i) => !ids.includes(i))), PULSE_MS);

  const defs = registry.data?.modules ?? [];
  const flowNodes: Node<ModuleNodeData>[] = config.modules.nodes.map((n) => ({
    id: n.id,
    type: "module",
    position: n.position,
    selected: n.id === selected,
    deletable: false,
    data: { def: defs.find((d) => d.type === n.moduleType), moduleType: n.moduleType, shake: shaking.has(n.id), problem: problems[n.id] ?? null },
  }));
  const flowEdges: Edge[] = [
    ...config.modules.edges.map((e) => ({ id: e.id, source: e.sourceNodeId, sourceHandle: e.sourcePortId, target: e.targetNodeId, targetHandle: e.targetPortId, className: pulsing.has(e.id) ? "ops-edge-ok" : undefined })),
    ...ghosts,
  ];

  const onNodesChange = (changes: NodeChange<Node<ModuleNodeData>>[]) => {
    for (const ch of changes) {
      // Drag frames update the present only; the undo point is recorded once in onNodeDragStart.
      if (ch.type === "position" && ch.position) setHist((h) => replace(h, moveNode(h.present, ch.id, ch.position!)));
      if (ch.type === "select" && ch.selected) setSelected(ch.id);
    }
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = applyEdgeChanges(changes, flowEdges);
    const kept = new Set(removed.map((e) => e.id));
    for (const e of config.modules.edges) if (!kept.has(e.id)) return edit(removeEdge(config, e.id));
  };
  // Every handle pair may be *attempted*; onConnect explains and animates refusals.
  const isValidConnection = (c: Connection | Edge): boolean => Boolean(registry.data && c.sourceHandle && c.targetHandle);
  const onConnect = (c: Connection) => {
    if (!registry.data || !c.sourceHandle || !c.targetHandle) return;
    const attempt = { sourceNodeId: c.source, sourcePortId: c.sourceHandle, targetNodeId: c.target, targetPortId: c.targetHandle };
    const reason = explainConnection(defs, registry.data.dataTypes, attempt, config);
    if (reason) {
      const id = `ghost-${edgeIdOf(attempt)}-${Date.now()}`;
      timed<Edge[]>(setGhosts, (g) => [...g, { id, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle, className: "ops-edge-reject", selectable: false, deletable: false }], (g) => g.filter((e) => e.id !== id), REJECT_MS);
      shake(c.target);
      notify.error(reason);
      return;
    }
    edit(addEdge(config, attempt));
    pulse([edgeIdOf(attempt)]);
  };

  const addSelected = () => {
    const def = defs.find((d) => d.type === toAdd);
    if (!def) return;
    const next = addModule(config, def, { x: 80 + (config.modules.nodes.length % 4) * 260, y: 60 + Math.floor(config.modules.nodes.length / 4) * 170 });
    edit(next);
    setSelected(def.type);
    setToAdd("");
    const problem = registry.data ? isolationProblem(defs, next, def.type) : null;
    if (problem) {
      setProblems((p) => ({ ...p, [def.type]: problem }));
      shake(def.type);
      notify.error(problem);
    }
  };

  // Keep "isolated" badges honest as wiring changes: recompute for every node with a recorded problem.
  useEffect(() => {
    setProblems((prev) => {
      const next: Record<string, string> = {};
      for (const id of Object.keys(prev)) {
        const p = isolationProblem(defs, config, id);
        if (p) next[id] = p;
      }
      return Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every((k) => next[k] === prev[k]) ? prev : next;
    });
  }, [config, defs]);

  const runPreset = (preset: Preset) => {
    const r = applyPreset(config, preset, defs);
    edit(r.config);
    pulse(r.newEdgeIds);
    notify.success(`${preset.name}: ${preset.modules.length} modules placed, ${r.newEdgeIds.length} typed connections wired`);
    setTimeout(() => flow.current?.fitView({ duration: 400, padding: 0.15 }), 60);
  };

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    try {
      return await fn();
    } catch (e) {
      const err = toRequestError(e);
      if (err.code === "stale_draft") setStale(true);
      if (err.code === "configuration_invalid") {
        setValidation({ valid: false, warnings: [], errors: (err.details ?? []).map((d) => ({ severity: "error" as const, stage: d.path, code: "", message: d.message })) });
      }
      notify.error(err.message);
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const validate = () =>
    run("validate", async () => {
      const r = await configApi.validate(siteId, config);
      setValidation(r);
      if (r.valid) notify.success("Configuration is valid");
      else notify.error(`${r.errors.length} validation error(s)`);
    });
  const saveDraft = () =>
    run("draft", async () => {
      const r = await configApi.saveDraft(siteId, activeVersion, config);
      setValidation(r.validation);
      notify.success("Draft saved");
    });
  const discardDraft = () =>
    run("draft", async () => {
      await configApi.discardDraft(siteId);
      setHist(createHistory(activeConfig));
      setValidation(null);
      notify.info("Draft discarded");
    });
  const preview = () =>
    run("preview", async () => {
      const r = await configApi.preview(siteId, config);
      setValidation(r.validation);
      setPreview(slug, r.configuration);
      navigate(`/preview/${slug}`);
    });
  const publish = (confirmDestructive: boolean) =>
    run("publish", async () => {
      const r = await releasesApi.publish(siteId, {
        baseVersion: activeVersion,
        configuration: config,
        note: note || undefined,
        ...(confirmDestructive ? { confirmDestructive: true } : {}),
      });
      setReviewing(false);
      notify.success(`Published release v${r.version}`);
      reload();
      navigate(`/s/${slug}/admin/releases`);
    });

  const selectedNode = config.modules.nodes.find((n) => n.id === selected);
  const selectedDef = defs.find((d) => d.type === selectedNode?.moduleType);
  const available = defs.filter((d) => !config.modules.nodes.some((n) => n.moduleType === d.type));

  if (registry.loading) return <LoadingState label="Loading module registry…" />;
  if (registry.error) return <ErrorState error={registry.error} onRetry={registry.reload} />;

  return (
    <>
      <PageHeader
        title="Configuration builder"
        subtitle={`Active release: v${activeVersion}. Only the server decides whether a draft can be published.`}
        actions={<Badge tone={validation === null ? "neutral" : validation.valid ? "success" : "danger"}>{validation === null ? (dirty ? "Unvalidated changes" : "No changes") : validation.valid ? "Valid draft" : `${validation.errors.length} error(s)`}</Badge>}
      />
      {stale && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-ui border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>The active release changed since you started editing. Reload to rebase onto the latest version (your unsaved edits will be discarded).</span>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-ui border border-line bg-surface p-2" role="toolbar" aria-label="Starter layouts">
        <span className="inline-flex items-center gap-1 px-1 text-xs font-medium text-muted"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Starter layouts</span>
        {PRESETS.map((p) => (
          <Button key={p.id} title={p.description} onClick={() => runPreset(p)}>{p.name}</Button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={hist.past.length === 0} onClick={doUndo}><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={hist.future.length === 0} onClick={doRedo}><Redo2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SelectField label="Add module" value={toAdd} onChange={(e) => setToAdd(e.target.value)} className="w-64">
          <option value="">Select a module…</option>
          {available.map((d) => <option key={d.type} value={d.type}>{d.displayName}</option>)}
        </SelectField>
        <Button disabled={!toAdd} onClick={addSelected}>Add</Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={validate} loading={busy === "validate"}>Validate</Button>
          <Button onClick={saveDraft} loading={busy === "draft"} disabled={!dirty}>Save draft</Button>
          {dirty && <Button variant="ghost" onClick={discardDraft} loading={busy === "draft"}>Discard</Button>}
          <Button onClick={preview} loading={busy === "preview"}>Preview</Button>
          <Button variant="primary" onClick={() => setReviewing(true)} loading={busy === "publish"} disabled={!validation?.valid || !dirty || stale}>Review & publish</Button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-[560px] rounded-ui border border-line bg-surface" aria-label="Module graph">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={() => setHist(checkpoint)}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onInit={(i) => { flow.current = i; }}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="flex flex-col gap-4">
          <Inspector config={config} node={selectedNode} def={selectedDef} defs={defs} onEdit={edit} onRemoved={() => setSelected(null)} />
          <FieldsPanel config={config} onChange={edit} />
          <Panel title="Release note">
            <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Panel>
        </div>
      </div>
      <div className="mt-4">
        <Panel title="Validation">
          {!validation ? (
            <p className="text-sm text-muted">Run “Validate” to check this draft with the server-side compiler.</p>
          ) : validation.errors.length === 0 && validation.warnings.length === 0 ? (
            <p className="text-sm text-success">No errors or warnings.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {[...validation.errors, ...validation.warnings].map((i, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <Badge tone={i.severity === "error" ? "danger" : "warning"}>{i.severity}</Badge>
                  <span><span className="text-muted">[{i.stage}]</span> {i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {reviewing && (
        <ImpactDialog
          siteId={siteId}
          request={{ baseVersion: activeVersion, configuration: config }}
          title={`Publish release v${activeVersion + 1}`}
          confirmLabel="Publish release"
          busy={busy === "publish"}
          onConfirm={(confirmDestructive) => publish(confirmDestructive)}
          onClose={() => setReviewing(false)}
        />
      )}
    </>
  );
}
