import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, Position, ReactFlow, applyEdgeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { ArrowLeft, Lock, LockOpen, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { CUSTOM_TEMPLATE_ID, type ConfigurationValidationResult, type ModuleDefinition, type SiteConfiguration, type WebsiteTemplate, type WebsiteTheme } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, PageHeader, Panel, SelectField, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import { configApi, releasesApi, sitesApi, websiteApi } from "../../services";
import { useCanBuildWebsites } from "../../stores/session";
import { notify } from "../../stores/toast";
import { addEdge, addModule, edgeIdOf, explainConnection, isolationProblem, moveNode, removeEdge } from "./configOps";
import { checkpoint, commit, createHistory, redo, replace, undo, type History } from "./history";
import { Inspector } from "./Inspector";
import { PRESETS, applyPreset, type Preset } from "./presets";
import { usePreviewStore } from "./previewStore";
import { ImpactDialog } from "../releases/ImpactDialog";
import { FieldsPanel } from "./FieldsPanel";
import { moduleColor } from "./moduleColors";
import { ModuleGallery, MODULE_DRAG_TYPE } from "./website-builder/ModuleGallery";
import { DeployedWebsites, TemplateGallery } from "./website-builder/TemplateGallery";
import { WEBSITE_THEMES } from "./website-builder/themes";
import { WebsiteBuilderSidebar, type SidebarTab } from "./website-builder/WebsiteBuilderSidebar";
import { WebsiteDeployPanel } from "./website-builder/WebsiteDeployPanel";
import { BoloAndBuild } from "./BoloAndBuild";

type ModuleNodeData = { def: ModuleDefinition | undefined; moduleType: string; shake: boolean; problem: string | null };

function ModuleNodeView({ data, selected }: NodeProps<Node<ModuleNodeData>>) {
  const def = data.def;
  const c = moduleColor(data.moduleType);
  const inputs = def?.ports.filter((p) => p.direction === "input") ?? [];
  const outputs = def?.ports.filter((p) => p.direction === "output") ?? [];
  const handle = { width: 12, height: 12, background: c.accent, border: "2px solid #1E293B", borderRadius: 999, boxShadow: "0 0 0 1px #1E293B" };
  const ring = data.problem ? "0 0 0 2px #EA4335" : selected ? "4px 4px 0px #FBBC04, 0 0 0 2px #1E293B" : "4px 4px 0px #1E293B";

  return (
    <div
      className={`w-64 overflow-visible rounded-2xl text-left transition-all ${data.shake ? "ops-shake" : ""}`}
      style={{ background: c.bg, border: `2px ${data.problem ? "dashed #EA4335" : "solid #1E293B"}`, boxShadow: ring }}
      data-testid={`node-${data.moduleType}`}
    >
      <div className="flex items-center justify-between gap-2 rounded-t-[14px] px-3.5 py-2.5" style={{ background: c.head, borderBottom: "2px solid #1E293B" }}>
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border border-[#1E293B]" style={{ background: c.accent }} />
          <span className="truncate font-['Outfit',sans-serif] text-[15px] font-bold leading-tight text-[#0F172A]">{def?.displayName ?? data.moduleType}</span>
        </span>
        <span className="shrink-0 rounded-full border border-[#1E293B] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide bg-white text-[#0F172A] shadow-[1px_1px_0px_#1E293B]">
          {def?.platformModule ? "Core" : "Module"}
        </span>
      </div>
      <div className="flex justify-between gap-3 px-3.5 py-3 text-[13px] font-medium" style={{ color: "#0F172A" }}>
        <ul className="space-y-1.5">
          {inputs.map((p) => (
            <li key={p.id} className="relative text-left">
              <Handle type="target" id={p.id} position={Position.Left} style={{ ...handle, left: -21 }} />
              <span style={{ color: c.accent }} aria-hidden>●</span> {p.label}
            </li>
          ))}
        </ul>
        <ul className="space-y-1.5 text-right">
          {outputs.map((p) => (
            <li key={p.id} className="relative">
              <Handle type="source" id={p.id} position={Position.Right} style={{ ...handle, right: -21 }} />
              {p.label} <span style={{ color: c.accent }} aria-hidden>●</span>
            </li>
          ))}
        </ul>
      </div>
      {data.problem && <p role="status" className="rounded-b-[14px] border-t-2 border-dashed border-[#EA4335] bg-[#FFF1F2] px-3.5 py-2 text-[12px] font-medium text-[#EA4335]">{data.problem}</p>}
    </div>
  );
}

const nodeTypes = { module: ModuleNodeView };

/**
 * Height that makes `ref` reach the bottom of its scrolling container (the shell's <main>), so the
 * builder panes fill the screen without the page scrolling. Only on wide screens, where the panes sit
 * side by side; narrow screens stack them and scroll normally.
 */
function useFillHeight(ref: RefObject<HTMLElement | null>, deps: unknown[]): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = (el.closest("main") as HTMLElement | null) ?? document.documentElement;
    const measure = () => {
      if (window.innerWidth < 1280) return setHeight(null);
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      setHeight(Math.max(480, Math.floor(scroller.clientHeight - top - padBottom)));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(scroller);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, deps);
  return height;
}

/**
 * A website being designed in the builder. It has its own undo history and never touches the site's
 * draft or releases; deploying creates a new site. Templates start `locked` (settings only).
 */
interface WebsiteWorkspace {
  templateId: string;
  templateName: string;
  theme: WebsiteTheme;
  hist: History<SiteConfiguration>;
  locked: boolean;
}

/** Fills optional sections and placeholder identity so builder edits work; the server assigns the real identity. */
function workspaceConfig(source: unknown, name: string): SiteConfiguration {
  const c = source as Partial<SiteConfiguration>;
  return { fields: [], customFields: [], reports: {}, calculatedFieldDefinitions: [], workflowDefinitions: [], metadata: {}, ...c, siteId: "website-draft", slug: "website-draft", name } as SiteConfiguration;
}
const REJECT_MS = 1500;
const PULSE_MS = 1400;

export function BuilderPage({ activeVersion, activeConfig }: { activeVersion: number; activeConfig: SiteConfiguration }) {
  const { siteId, slug, reload } = useSiteRuntime();
  const navigate = useNavigate();
  const setPreview = usePreviewStore((s) => s.setDraft);
  const registry = useAsync(async () => ({ modules: await sitesApi.modules(), dataTypes: await sitesApi.dataTypes() }), []);

  // The website builder appears only for platform admins, and only in the host site's builder.
  const isPlatformAdmin = useCanBuildWebsites();
  const host = useAsync(() => (isPlatformAdmin ? websiteApi.host() : Promise.resolve(null)), [isPlatformAdmin]);
  const canBuildWebsites = isPlatformAdmin && Boolean(host.data?.siteId) && host.data?.siteId === siteId;
  const templates = useAsync(() => (canBuildWebsites ? websiteApi.templates() : Promise.resolve([])), [canBuildWebsites]);
  const websites = useAsync(() => (canBuildWebsites ? websiteApi.listDeployed() : Promise.resolve([])), [canBuildWebsites]);
  const [sideTab, setSideTab] = useState<SidebarTab>("templates");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [sideQuery, setSideQuery] = useState("");

  // Working config lives in an undo/redo history; server verdict, selection and release state are separate.
  // The site's history and a website workspace's history are kept apart; `setHist` edits whichever is open.
  const [siteHist, setSiteHist] = useState(() => createHistory(activeConfig));
  const [webState, setWeb] = useState<WebsiteWorkspace | null>(null);
  const web = canBuildWebsites ? webState : null;
  const inWebsite = web !== null;
  const locked = web?.locked ?? false;
  const hist = web ? web.hist : siteHist;
  const setHist = useCallback(
    (fn: (h: History<SiteConfiguration>) => History<SiteConfiguration>) => (inWebsite ? setWeb((w) => w && { ...w, hist: fn(w.hist) }) : setSiteHist(fn)),
    [inWebsite],
  );
  const config = hist.present;
  const [validation, setValidation] = useState<ConfigurationValidationResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"validate" | "draft" | "preview" | "publish" | null>(null);
  const [stale, setStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const dirty = useMemo(() => JSON.stringify(siteHist.present) !== JSON.stringify(activeConfig), [siteHist.present, activeConfig]);

  // Visual feedback state: valid-edge pulses, rejected "ghost" edges and shaking nodes.
  const [pulsing, setPulsing] = useState<ReadonlySet<string>>(new Set());
  const [ghosts, setGhosts] = useState<Edge[]>([]);
  const [shaking, setShaking] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const flow = useRef<ReactFlowInstance<Node<ModuleNodeData>, Edge> | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const fillHeight = useFillHeight(workspace, [inWebsite, stale, registry.loading]);

  const edit = useCallback((next: SiteConfiguration) => {
    setHist((h) => commit(h, next));
    setValidation(null); // any edit invalidates the previous server verdict
  }, [setHist]);
  const doUndo = useCallback(() => { setHist(undo); setValidation(null); }, [setHist]);
  const doRedo = useCallback(() => { setHist(redo); setValidation(null); }, [setHist]);

  useEffect(() => {
    let active = true;
    configApi.draft(siteId).then((d) => {
      if (!active || !d || !d.configuration) return;
      if (d.baseVersion === activeVersion) {
        setSiteHist(createHistory(d.configuration));
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
    draggable: !locked,
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
    if (locked) return;
    const removed = applyEdgeChanges(changes, flowEdges);
    const kept = new Set(removed.map((e) => e.id));
    for (const e of config.modules.edges) if (!kept.has(e.id)) return edit(removeEdge(config, e.id));
  };
  // Every handle pair may be *attempted*; onConnect explains and animates refusals.
  const isValidConnection = (c: Connection | Edge): boolean => Boolean(registry.data && c.sourceHandle && c.targetHandle);
  const onConnect = (c: Connection) => {
    if (locked) return;
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

  const placeModule = (type: string, position?: { x: number; y: number }) => {
    const def = defs.find((d) => d.type === type);
    if (!def) return;
    const next = addModule(config, def, position ?? { x: 80 + (config.modules.nodes.length % 4) * 300, y: 60 + Math.floor(config.modules.nodes.length / 4) * 190 });
    edit(next);
    setSelected(def.type);
    const problem = registry.data ? isolationProblem(defs, next, def.type) : null;
    if (problem) {
      setProblems((p) => ({ ...p, [def.type]: problem }));
      shake(def.type);
      notify.error(problem);
    }
  };
  const addSelected = () => {
    placeModule(toAdd);
    setToAdd("");
  };

  // ---------- website builder (platform admins)
  const openTemplate = (t: WebsiteTemplate) => {
    setWeb({ templateId: t.id, templateName: t.name, theme: t.theme, hist: createHistory(workspaceConfig(t.configuration, t.name)), locked: true });
    setSelected(null);
    setValidation(null);
    setProblems({});
    notify.info(`${t.name} loaded. Structure is locked; tweak module settings, then deploy.`);
    setTimeout(() => flow.current?.fitView({ duration: 400, padding: 0.15 }), 60);
  };
  const startCustomWebsite = () => {
    const { website: _w, ...rest } = config;
    setWeb({ templateId: CUSTOM_TEMPLATE_ID, templateName: "Custom website", theme: config.website ?? WEBSITE_THEMES[0]!, hist: createHistory(workspaceConfig(rest, "Custom website")), locked: false });
    setSelected(null);
    setValidation(null);
    notify.info("Custom website started from this site’s modules. Everything is editable.");
  };
  const unlock = () => {
    setWeb((w) => w && { ...w, locked: false });
    notify.info("Template unlocked: add, remove and rewire modules freely.");
  };
  const addFromGallery = (type: string, position?: { x: number; y: number }) => {
    if (locked) unlock();
    placeModule(type, position);
  };
  const exitWebsite = () => {
    setWeb(null);
    setSelected(null);
    setValidation(null);
    setProblems({});
    setTimeout(() => flow.current?.fitView({ duration: 300, padding: 0.15 }), 60);
  };
  const onCanvasDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onCanvasDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(MODULE_DRAG_TYPE) || e.dataTransfer.getData("text/plain");
    if (!type) return;
    const pos = flow.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addFromGallery(type, pos ? { x: Math.round(pos.x - 120), y: Math.round(pos.y - 40) } : undefined);
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
      setSiteHist(createHistory(activeConfig));
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
        subtitle={web ? `Designing a new website from “${web.templateName}”. Deploying creates a separate site; this site is not changed.` : `Active release: v${activeVersion}. Only the server decides whether a draft can be published.`}
        actions={<Badge tone={validation === null ? "neutral" : validation.valid ? "success" : "danger"}>{validation === null ? (web ? "Website draft" : dirty ? "Unvalidated changes" : "No changes") : validation.valid ? "Valid draft" : `${validation.errors.length} error(s)`}</Badge>}
      />
      {stale && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-ui border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>The active release changed since you started editing. Reload to rebase onto the latest version (your unsaved edits will be discarded).</span>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )}
      {web ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border-2 border-[#1E293B] bg-white p-3 shadow-[4px_4px_0px_#1E293B]" role="toolbar" aria-label="Website workspace">
          <Button variant="ghost" onClick={exitWebsite}><ArrowLeft className="h-4 w-4" aria-hidden /> Back to site configuration</Button>
          <span className="inline-flex items-center gap-2 border-l-2 border-[#1E293B] px-3 text-xs font-bold text-[#0F172A]">
            <span aria-hidden className="h-3 w-3 rounded-full border border-[#1E293B]" style={{ background: web.theme.palette.primary }} />
            {web.templateName}
          </span>
          {locked ? (
            <Button onClick={unlock} title="Unlock to add, remove and rewire modules"><Lock className="h-3.5 w-3.5" aria-hidden /> Structure locked</Button>
          ) : (
            <Badge tone="yellow"><LockOpen className="mr-1 h-3 w-3" aria-hidden /> Free editing</Badge>
          )}
          <div className="ml-auto flex items-center gap-1 border-l-2 border-[#1E293B] pl-2">
            <Button onClick={validate} loading={busy === "validate"} className="uppercase font-mono">Validate</Button>
            <Button variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={hist.past.length === 0} onClick={doUndo}><Undo2 className="h-4 w-4 text-[#0F172A]" /></Button>
            <Button variant="ghost" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={hist.future.length === 0} onClick={doRedo}><Redo2 className="h-4 w-4 text-[#0F172A]" /></Button>
          </div>
        </div>
      ) : (
      <>
      <BoloAndBuild
        config={config}
        defs={defs}
        onApplyConfig={(nextConfig) => {
          edit(nextConfig);
        }}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border-2 border-[#1E293B] bg-white p-3 shadow-[4px_4px_0px_#1E293B]" role="toolbar" aria-label="Starter layouts">
        <span className="inline-flex items-center gap-1.5 px-2 font-mono text-xs font-black uppercase tracking-wider text-[#0F172A]"><Sparkles className="h-4 w-4 text-[#FBBC04]" aria-hidden /> TEMPLATES</span>
        {PRESETS.map((p) => (
          <Button key={p.id} title={p.description} onClick={() => runPreset(p)}>{p.name}</Button>
        ))}
        <div className="ml-auto flex items-center gap-1 border-l-2 border-[#1E293B] pl-2">
          <Button variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={hist.past.length === 0} onClick={doUndo}><Undo2 className="h-4 w-4 text-[#0F172A]" /></Button>
          <Button variant="ghost" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={hist.future.length === 0} onClick={doRedo}><Redo2 className="h-4 w-4 text-[#0F172A]" /></Button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-[#1E293B] bg-white p-4 shadow-[4px_4px_0px_#1E293B]">
        <SelectField label="Add module" value={toAdd} onChange={(e) => setToAdd(e.target.value)} className="w-56">
          <option value="">Select a module…</option>
          {available.map((d) => <option key={d.type} value={d.type}>{d.displayName}</option>)}
        </SelectField>
        <Button disabled={!toAdd} onClick={addSelected} variant="primary">Add</Button>
        <div className="hidden lg:flex items-center gap-2 border-l-2 border-[#1E293B] pl-3">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#64748B] mr-1">Drag & Drop:</span>
          {available.slice(0, 5).map((d) => (
            <button
              key={d.type}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MODULE_DRAG_TYPE, d.type);
                e.dataTransfer.setData("text/plain", d.type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => placeModule(d.type)}
              title={`Drag onto canvas or click to add ${d.displayName}`}
              className="cursor-grab active:cursor-grabbing rounded-xl border-2 border-[#1E293B] bg-slate-50 px-3 py-1.5 font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B] transition hover:bg-[#FBBC04] hover:shadow-[3px_3px_0px_#1E293B]"
            >
              + {d.displayName}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={validate} loading={busy === "validate"} className="uppercase font-mono">Validate</Button>
          <Button onClick={saveDraft} loading={busy === "draft"} disabled={!dirty} className="uppercase font-mono">Save draft</Button>
          {dirty && <Button variant="ghost" onClick={discardDraft} loading={busy === "draft"} className="uppercase font-mono">Discard</Button>}
          <Button onClick={preview} loading={busy === "preview"} className="uppercase font-mono">Preview</Button>
          <Button variant="primary" onClick={() => setReviewing(true)} loading={busy === "publish"} disabled={!validation?.valid || !dirty || stale} className="uppercase font-mono">Review & publish</Button>
        </div>
      </div>
      </>
      )}
      <div ref={workspace} className="flex flex-col gap-4 xl:flex-row" style={fillHeight ? { height: fillHeight } : undefined}>
        {canBuildWebsites && (
          <WebsiteBuilderSidebar
            tab={sideTab}
            onTab={(t) => { setSideTab(t); setSideQuery(""); }}
            collapsed={sideCollapsed}
            onCollapsed={setSideCollapsed}
            query={sideQuery}
            onQuery={setSideQuery}
          >
            {sideTab === "templates" ? (
              templates.error ? (
                <ErrorState error={templates.error} onRetry={templates.reload} />
              ) : templates.loading ? (
                <p className="py-6 text-center text-xs text-[#697386]">Loading templates…</p>
              ) : (
                <>
                  <TemplateGallery templates={templates.data ?? []} query={sideQuery} selectedId={web?.templateId ?? null} onSelect={openTemplate} />
                  <DeployedWebsites websites={websites.data ?? []} onChanged={websites.reload} />
                </>
              )
            ) : (
              <>
                {!web && (
                  <div className="mb-3 rounded-xl border-2 border-[#1E293B] bg-[#FEF3C7] p-2.5 text-[11px] font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">
                    Modules added here change <strong className="text-[#0F172A]">this site’s</strong> draft.
                    <button type="button" onClick={startCustomWebsite} className="ml-1 font-bold text-[#2563EB] underline underline-offset-2">Design a custom website instead</button>
                  </div>
                )}
                <ModuleGallery defs={defs} config={config} query={sideQuery} locked={locked} onAdd={(t) => addFromGallery(t)} onUnlock={locked ? unlock : undefined} />
              </>
            )}
          </WebsiteBuilderSidebar>
        )}
        <div
          className={`relative h-[580px] min-w-0 flex-1 rounded-2xl xl:h-full border-2 border-[#1E293B] bg-[#F8FAFC] shadow-[4px_4px_0px_#1E293B] overflow-hidden`}
          aria-label="Module graph"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          {locked && (
            <span className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border-2 border-[#1E293B] bg-[#FBBC04] px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Template structure is read-only
            </span>
          )}
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
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
            defaultEdgeOptions={{ style: { stroke: "#1E293B", strokeWidth: 2 } }}
            fitView
            nodesDraggable={!locked}
            nodesConnectable={!locked}
            edgesFocusable={!locked}
            deleteKeyCode={locked ? null : ["Backspace", "Delete"]}
          >
            <Background color="#CBD5E1" gap={24} size={1.5} />
            <Controls className="bg-white border-2 border-[#1E293B] text-[#0F172A] rounded-xl shadow-[2px_2px_0px_#1E293B] overflow-hidden [&>button]:border-b-2 [&>button]:border-[#1E293B] [&>button]:bg-white hover:[&>button]:bg-[#FBBC04]" />
          </ReactFlow>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-4 xl:h-full xl:w-[360px] xl:overflow-y-auto xl:pr-1 [&>*]:shrink-0">
          {web && (
            <WebsiteDeployPanel
              templateId={web.templateId}
              templateName={web.templateName}
              theme={web.theme}
              onTheme={(theme) => setWeb((w) => w && { ...w, theme })}
              config={config}
              onDeployed={websites.reload}
            />
          )}
          <Inspector config={config} node={selectedNode} def={selectedDef} defs={defs} onEdit={edit} onRemoved={() => setSelected(null)} settingsOnly={locked} />
          {!locked && <FieldsPanel config={config} onChange={edit} />}
          {!web && (
            <Panel title="Release note">
              <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Panel>
          )}
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
