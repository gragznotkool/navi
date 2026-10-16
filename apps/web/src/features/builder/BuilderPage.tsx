import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, Position, ReactFlow, applyEdgeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ConfigurationValidationResult, ModuleDefinition, SiteConfiguration } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, PageHeader, Panel, SelectField, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import { configApi, releasesApi, sitesApi } from "../../services";
import { notify } from "../../stores/toast";
import { addEdge, addModule, canConnect, moveNode, removeEdge, removeModule, setNodeConfig } from "./configOps";
import { usePreviewStore } from "./previewStore";

type ModuleNodeData = { def: ModuleDefinition | undefined; moduleType: string };

function ModuleNodeView({ data, selected }: NodeProps<Node<ModuleNodeData>>) {
  const def = data.def;
  const inputs = def?.ports.filter((p) => p.direction === "input") ?? [];
  const outputs = def?.ports.filter((p) => p.direction === "output") ?? [];
  return (
    <div className={`w-56 rounded-ui border bg-surface text-xs ${selected ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-semibold text-ink">{def?.displayName ?? data.moduleType}</span>
        {def?.platformModule && <Badge tone="info">platform</Badge>}
      </div>
      <div className="flex justify-between gap-2 px-3 py-2 text-muted">
        <ul>
          {inputs.map((p, i) => (
            <li key={p.id} className="relative py-0.5">
              <Handle type="target" id={p.id} position={Position.Left} style={{ top: 8 + i * 0, left: -13 }} />
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
    </div>
  );
}

const nodeTypes = { module: ModuleNodeView };

export function BuilderPage({ activeVersion, activeConfig }: { activeVersion: number; activeConfig: SiteConfiguration }) {
  const { siteId, slug, reload } = useSiteRuntime();
  const navigate = useNavigate();
  const setPreview = usePreviewStore((s) => s.setDraft);
  const registry = useAsync(async () => ({ modules: await sitesApi.modules(), dataTypes: await sitesApi.dataTypes() }), []);

  // Four separate concerns: working graph/config, server validation output, selection, release state (props).
  const [config, setConfig] = useState<SiteConfiguration>(activeConfig);
  const [validation, setValidation] = useState<ConfigurationValidationResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"validate" | "draft" | "preview" | "publish" | null>(null);
  const [stale, setStale] = useState(false);
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(activeConfig), [config, activeConfig]);

  const edit = useCallback((next: SiteConfiguration) => {
    setConfig(next);
    setValidation(null); // any edit invalidates the previous server verdict
  }, []);

  const defs = registry.data?.modules ?? [];
  const flowNodes: Node<ModuleNodeData>[] = config.modules.nodes.map((n) => ({
    id: n.id,
    type: "module",
    position: n.position,
    selected: n.id === selected,
    deletable: false,
    data: { def: defs.find((d) => d.type === n.moduleType), moduleType: n.moduleType },
  }));
  const flowEdges: Edge[] = config.modules.edges.map((e) => ({ id: e.id, source: e.sourceNodeId, sourceHandle: e.sourcePortId, target: e.targetNodeId, targetHandle: e.targetPortId }));

  const onNodesChange = (changes: NodeChange<Node<ModuleNodeData>>[]) => {
    for (const ch of changes) {
      // Positions update live so dragging is smooth; they never invalidate validation.
      if (ch.type === "position" && ch.position) setConfig((c) => moveNode(c, ch.id, ch.position!));
      if (ch.type === "select" && ch.selected) setSelected(ch.id);
    }
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = applyEdgeChanges(changes, flowEdges);
    const kept = new Set(removed.map((e) => e.id));
    for (const e of config.modules.edges) if (!kept.has(e.id)) return edit(removeEdge(config, e.id));
  };
  const isValidConnection = (c: Connection | Edge): boolean =>
    Boolean(registry.data && c.sourceHandle && c.targetHandle && canConnect(defs, registry.data.dataTypes, { sourceNodeId: c.source, sourcePortId: c.sourceHandle, targetNodeId: c.target, targetPortId: c.targetHandle }, config));
  const onConnect = (c: Connection) => {
    if (c.sourceHandle && c.targetHandle) edit(addEdge(config, { sourceNodeId: c.source, sourcePortId: c.sourceHandle, targetNodeId: c.target, targetPortId: c.targetHandle }));
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
  const preview = () =>
    run("preview", async () => {
      const r = await configApi.preview(siteId, config);
      setValidation(r.validation);
      setPreview(slug, r.configuration);
      navigate(`/preview/${slug}`);
    });
  const publish = () =>
    run("publish", async () => {
      const r = await releasesApi.publish(siteId, { baseVersion: activeVersion, configuration: config, note: note || undefined });
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
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SelectField label="Add module" value={toAdd} onChange={(e) => setToAdd(e.target.value)} className="w-64">
          <option value="">Select a module…</option>
          {available.map((d) => <option key={d.type} value={d.type}>{d.displayName}</option>)}
        </SelectField>
        <Button
          disabled={!toAdd}
          onClick={() => {
            const def = defs.find((d) => d.type === toAdd);
            if (!def) return;
            edit(addModule(config, def, { x: 80 + (config.modules.nodes.length % 4) * 260, y: 60 + Math.floor(config.modules.nodes.length / 4) * 170 }));
            setSelected(def.type);
            setToAdd("");
          }}
        >
          Add
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={validate} loading={busy === "validate"}>Validate</Button>
          <Button onClick={saveDraft} loading={busy === "draft"} disabled={!dirty}>Save draft</Button>
          <Button onClick={preview} loading={busy === "preview"}>Preview</Button>
          <Button variant="primary" onClick={publish} loading={busy === "publish"} disabled={!validation?.valid || !dirty || stale}>Publish</Button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-[560px] rounded-ui border border-line bg-surface" aria-label="Module graph">
          <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} fitView deleteKeyCode={["Backspace", "Delete"]}>
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title={selectedDef ? selectedDef.displayName : "Module settings"}>
            {!selectedNode || !selectedDef ? (
              <p className="text-sm text-muted">Select a module in the graph to edit its settings.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">{selectedDef.description}</p>
                {selectedDef.configFields.length === 0 && <p className="text-xs text-muted">This module has no configurable settings.</p>}
                {selectedDef.configFields.map((f) => (
                  <TextField
                    key={f.key}
                    label={f.label}
                    type={f.type === "number" ? "number" : "text"}
                    value={String(selectedNode.config[f.key] ?? "")}
                    onChange={(e) => edit(setNodeConfig(config, selectedNode.id, f.key, e.target.value === "" ? undefined : f.type === "number" ? Number(e.target.value) : e.target.value))}
                  />
                ))}
                <Button
                  variant="danger"
                  disabled={selectedDef.platformModule}
                  title={selectedDef.platformModule ? "Platform modules are mandatory" : undefined}
                  onClick={() => {
                    edit(removeModule(config, selectedNode.id, defs));
                    setSelected(null);
                  }}
                >
                  Remove module
                </Button>
                {selectedDef.platformModule && <p className="text-xs text-muted">Platform modules are mandatory and cannot be removed.</p>}
              </div>
            )}
          </Panel>
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
    </>
  );
}
