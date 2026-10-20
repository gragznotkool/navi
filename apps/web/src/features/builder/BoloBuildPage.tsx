import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bot,
  Sparkles,
  Send,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Layers,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  GitCommit,
  RefreshCw,
  PlusCircle,
  FileCheck2,
  History,
  FileCode,
  ThumbsUp,
  ThumbsDown,
  UploadCloud,
  ChevronRight,
  Sliders,
  AlertCircle,
  Building2,
} from "lucide-react";
import type {
  ConfigurationProposal,
  ProposalStatus,
  SiteConfiguration,
  SiteSummary,
} from "@opshub/contracts";
import { Badge, Button, PageHeader, Panel, SelectField, TextField } from "../../components/ui";
import { ErrorState, LoadingState } from "../../components/feedback";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { proposalsApi, sitesApi, releasesApi } from "../../services";
import { useSession } from "../../stores/session";
import { notify } from "../../stores/toast";

const EXAMPLE_PROMPTS = [
  "In the Distribution site, enable a Returns workflow. Allow authorized store managers to create return requests, require supervisor approval, record the item, quantity, return reason, and status, and restrict approval to authorized supervisors.",
  "Add supervisor approval before material assignment to prevent double component allocation.",
  "Add a PCB repair status workflow for L3/L4 component rework with inspection signoff.",
  "Restrict Excel exports and financial reports strictly to authorized supervisors.",
  "Add component consumption tracking with lot number verification for ISO 9001:2015 traceability.",
];

export function BoloBuildPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useSession((s) => s.session);

  // 1. Sites list
  const sites = useAsync(() => sitesApi.list(), []);
  const initialSiteId = searchParams.get("siteId") || "";
  const [selectedSiteId, setSelectedSiteId] = useState<string>(initialSiteId);

  // Sync selectedSiteId once sites load
  useEffect(() => {
    if (!selectedSiteId && sites.data && sites.data.length > 0) {
      const match = initialSiteId
        ? sites.data.find((s) => s.id === initialSiteId)
        : sites.data[0];
      if (match) setSelectedSiteId(match.id);
    }
  }, [sites.data, initialSiteId, selectedSiteId]);

  // Update query param
  const handleSelectSite = (id: string) => {
    setSelectedSiteId(id);
    setSearchParams({ siteId: id });
    setSelectedProposalId(null);
  };

  const selectedSite = sites.data?.find((s) => s.id === selectedSiteId);

  // Active site configuration context
  const siteConfig = useAsync(
    () => (selectedSiteId ? sitesApi.config(selectedSiteId) : Promise.resolve(null)),
    [selectedSiteId]
  );

  // Proposals list
  const proposals = useAsync(
    () => (selectedSiteId ? proposalsApi.list(selectedSiteId) : Promise.resolve([])),
    [selectedSiteId]
  );

  // Active proposal selection
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const selectedProposal = proposals.data?.find((p) => p.id === selectedProposalId);

  // Natural Language Prompt State
  const [prompt, setPrompt] = useState("");
  const [refinementPrompt, setRefinementPrompt] = useState("");
  const [busyState, setBusyState] = useState<
    "generating" | "refining" | "submitting" | "deciding" | "publishing" | null
  >(null);
  const [progressStage, setProgressStage] = useState<string>("");

  // Tab view within workspace: "editor" | "proposals" | "releases"
  const [activeTab, setActiveTab] = useState<"new" | "review" | "history">("new");
  const [showJsonView, setShowJsonView] = useState(false);

  // Handle Generate Proposal
  const handleGenerate = async (textToUse = prompt) => {
    if (!selectedSiteId || !textToUse.trim()) return;
    setBusyState("generating");
    setProgressStage("Analyzing natural language requirement…");

    try {
      setTimeout(() => setProgressStage("Identifying operational modules and schema contracts…"), 400);
      setTimeout(() => setProgressStage("Synthesizing structured configuration patch…"), 800);
      setTimeout(() => setProgressStage("Running compiler validation and security checks…"), 1200);

      const prop = await proposalsApi.create(selectedSiteId, {
        siteId: selectedSiteId,
        prompt: textToUse.trim(),
      });

      notify.success("Configuration proposal synthesized successfully!");
      await proposals.reload();
      setSelectedProposalId(prop.id);
      setActiveTab("review");
      setPrompt("");
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusyState(null);
      setProgressStage("");
    }
  };

  // Handle Refinement
  const handleRefine = async () => {
    if (!selectedSiteId || !selectedProposalId || !refinementPrompt.trim()) return;
    setBusyState("refining");
    try {
      const updated = await proposalsApi.update(selectedSiteId, selectedProposalId, {
        refinementPrompt: refinementPrompt.trim(),
      });
      notify.success("Proposal refined and re-validated!");
      await proposals.reload();
      setSelectedProposalId(updated.id);
      setRefinementPrompt("");
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusyState(null);
    }
  };

  // Handle Submit for Approval
  const handleSubmitApproval = async () => {
    if (!selectedSiteId || !selectedProposalId) return;
    setBusyState("submitting");
    try {
      await proposalsApi.submit(selectedSiteId, selectedProposalId);
      notify.success("Proposal submitted for review & approval.");
      await proposals.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusyState(null);
    }
  };

  // Handle Approve / Reject
  const handleDecision = async (decision: "approve" | "reject") => {
    if (!selectedSiteId || !selectedProposalId) return;
    setBusyState("deciding");
    try {
      await proposalsApi.decide(selectedSiteId, selectedProposalId, {
        decision,
        comment: `Decision by ${user?.user.displayName ?? "Authorized Reviewer"}`,
      });
      notify.success(`Proposal ${decision === "approve" ? "approved" : "rejected"}.`);
      await proposals.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusyState(null);
    }
  };

  // Handle Publish Release
  const handlePublish = async () => {
    if (!selectedSiteId || !selectedProposalId) return;
    setBusyState("publishing");
    try {
      const result = await proposalsApi.publish(selectedSiteId, selectedProposalId, {
        confirmDestructive: true,
      });
      notify.success(`Published as Release v${result.releaseVersion} successfully!`);
      await proposals.reload();
      await siteConfig.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusyState(null);
    }
  };

  const statusTone: Record<ProposalStatus, "neutral" | "yellow" | "success" | "danger" | "info"> = {
    draft: "neutral",
    generated: "yellow",
    validated: "info",
    pending_approval: "yellow",
    approved: "success",
    rejected: "danger",
    published: "success",
  };

  const statusLabel: Record<ProposalStatus, string> = {
    draft: "Draft",
    generated: "Generated",
    validated: "Validated",
    pending_approval: "Pending Approval",
    approved: "Approved",
    rejected: "Rejected",
    published: "Published Live",
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F0F4F8] text-[#0F172A]">
      {/* 1. Master Application Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b-2 border-[#1E293B] bg-white px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-[#1E293B] bg-[#FBBC04] text-[#1E293B] shadow-[2px_2px_0px_#1E293B]">
              <Bot className="h-5 w-5" />
            </span>
            <div className="flex flex-col">
              <span className="font-['Outfit',sans-serif] text-sm font-black tracking-tight text-[#0F172A]">
                OpsHub / Bolo &amp; Build
              </span>
              <span className="font-mono text-[10px] font-bold text-[#64748B]">
                AI-Powered Configuration Studio
              </span>
            </div>
          </Link>

          <span className="mx-2 text-[#CBD5E1]">|</span>

          {/* Current Site Selector */}
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#64748B]" />
            <select
              value={selectedSiteId}
              onChange={(e) => handleSelectSite(e.target.value)}
              className="h-9 rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] px-3 font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B] focus:outline-none"
            >
              {sites.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.slug})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* User Identity & Active Release */}
        <div className="flex items-center gap-4">
          {siteConfig.data && (
            <div className="hidden md:flex items-center gap-2 rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] px-3 py-1 font-mono text-xs font-bold shadow-[2px_2px_0px_#1E293B]">
              <span className="h-2 w-2 rounded-full bg-[#34A853] animate-pulse" />
              <span>Active Release: v{siteConfig.data.version}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#1E293B] bg-[#FBBC04]/20 px-2.5 py-0.5 font-['Outfit',sans-serif] text-xs font-bold text-[#1E293B]">
              {user?.user.displayName ?? "Administrator"}
            </span>
            {selectedSite && (
              <Link
                to={`/s/${selectedSite.slug}/admin/builder`}
                className="text-xs font-bold text-[#4285F4] hover:underline"
              >
                Canvas View &rarr;
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Studio Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Navigation & Proposals */}
        <aside className="flex w-72 shrink-0 flex-col border-r-2 border-[#1E293B] bg-white">
          <div className="border-b border-[#E2E8F0] p-3">
            <Button
              variant="blue"
              onClick={() => {
                setActiveTab("new");
                setSelectedProposalId(null);
              }}
              className="w-full text-xs"
            >
              <PlusCircle className="h-4 w-4" /> New Requirement
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-wider text-[#64748B]">
                Proposals &amp; Drafts
              </span>
              <Badge tone="neutral">{proposals.data?.length ?? 0}</Badge>
            </div>

            {proposals.loading && <LoadingState label="Loading proposals…" />}
            {proposals.data && proposals.data.length === 0 && (
              <p className="py-6 text-center text-xs text-[#94A3B8]">
                No proposals yet for this site. Describe a requirement to create one.
              </p>
            )}

            <ul className="flex flex-col gap-2">
              {proposals.data?.map((p) => {
                const isSelected = p.id === selectedProposalId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProposalId(p.id);
                        setActiveTab("review");
                      }}
                      className={`group flex w-full flex-col gap-1 rounded-xl border-2 p-3 text-left transition-all ${
                        isSelected
                          ? "border-[#1E293B] bg-[#FBBC04]/10 shadow-[3px_3px_0px_#1E293B]"
                          : "border-[#E2E8F0] bg-white hover:border-[#1E293B] hover:shadow-[2px_2px_0px_#1E293B]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A]">
                          {p.title}
                        </span>
                        <Badge tone={statusTone[p.status]}>{statusLabel[p.status]}</Badge>
                      </div>
                      <span className="line-clamp-2 text-[11px] text-[#64748B]">
                        &ldquo;{p.prompt}&rdquo;
                      </span>
                      <span className="mt-1 font-mono text-[9px] text-[#94A3B8]">
                        {formatDateTime(p.createdAt)} · {p.createdByName}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Quick Context Summary Footer */}
          <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[11px]">
            <span className="font-bold text-[#0F172A]">Site Scope:</span>{" "}
            <span className="font-mono text-[#64748B]">{selectedSite?.name}</span>
            <div className="mt-1 text-[10px] text-[#64748B]">
              RLS tenant data strictly isolated to {selectedSite?.slug}
            </div>
          </div>
        </aside>

        {/* Center / Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "new" || !selectedProposal ? (
            /* ==============================================================
               NATURAL LANGUAGE REQUIREMENT EDITOR
               ============================================================== */
            <div className="mx-auto max-w-4xl flex flex-col gap-6">
              <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-6 shadow-[4px_4px_0px_#1E293B]">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="h-5 w-5 text-[#FBBC04]" />
                  <h1 className="font-['Outfit',sans-serif] text-xl font-black text-[#0F172A]">
                    What would you like to configure?
                  </h1>
                </div>
                <p className="text-xs text-[#64748B]">
                  Describe operational workflows, permission gating, or module requirements in natural language.
                  Bolo &amp; Build will compile a validated, structured proposal for review.
                </p>

                {/* Multiline Editor */}
                <div className="mt-4">
                  <textarea
                    rows={4}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder='Example: "In the Distribution site, enable a Returns workflow. Allow authorized store managers to create return requests, require supervisor approval, record the item, quantity, return reason, and status, and restrict approval to authorized supervisors."'
                    className="w-full rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] p-3.5 font-['Outfit',sans-serif] text-sm text-[#0F172A] shadow-[2px_2px_0px_#1E293B] placeholder:text-[#94A3B8] focus:border-[#4285F4] focus:outline-none"
                  />
                </div>

                {/* Example Requirement Chips */}
                <div className="mt-3">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Example Requirements:
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {EXAMPLE_PROMPTS.map((ex, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPrompt(ex)}
                        className="rounded-lg border-2 border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-left text-xs font-semibold text-[#1E293B] transition hover:border-[#1E293B] hover:bg-[#FBBC04]/20"
                      >
                        &ldquo;{ex.slice(0, 68)}…&rdquo;
                      </button>
                    ))}
                  </div>
                </div>

                {/* Generation Action */}
                <div className="mt-6 flex items-center justify-between border-t border-[#E2E8F0] pt-4">
                  <div className="flex items-center gap-2 text-xs text-[#64748B]">
                    <ShieldCheck className="h-4 w-4 text-[#34A853]" />
                    <span>Schema-validated output · PostgreSQL RLS Isolation enforced</span>
                  </div>

                  <Button
                    variant="primary"
                    disabled={!prompt.trim() || Boolean(busyState)}
                    loading={busyState === "generating"}
                    onClick={() => handleGenerate()}
                    className="h-11 px-6 font-black uppercase tracking-wider"
                  >
                    <Sparkles className="h-4 w-4" /> Generate Configuration
                  </Button>
                </div>

                {/* Progress / Loading Pipeline */}
                {busyState === "generating" && (
                  <div className="mt-4 rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] p-4 font-mono text-xs shadow-[2px_2px_0px_#1E293B] animate-pulse">
                    <div className="flex items-center gap-2 font-bold text-[#1E293B]">
                      <RefreshCw className="h-4 w-4 animate-spin text-[#4285F4]" />
                      <span>{progressStage}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Site Context Panel */}
              {siteConfig.data && (
                <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-6 shadow-[4px_4px_0px_#1E293B]">
                  <h2 className="font-['Outfit',sans-serif] text-sm font-black uppercase tracking-wider text-[#1E293B] mb-3">
                    Active Context: {selectedSite?.name}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                      <span className="block text-[11px] font-bold text-[#64748B]">Active Release</span>
                      <span className="font-mono text-sm font-black text-[#0F172A]">
                        v{siteConfig.data.version}
                      </span>
                    </div>
                    <div className="rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                      <span className="block text-[11px] font-bold text-[#64748B]">Active Modules</span>
                      <span className="font-mono text-sm font-black text-[#0F172A]">
                        {siteConfig.data.configuration.modules.nodes.length} Nodes Configured
                      </span>
                    </div>
                    <div className="rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                      <span className="block text-[11px] font-bold text-[#64748B]">Layout &amp; Shell</span>
                      <span className="font-mono text-sm font-black text-[#0F172A] uppercase">
                        {siteConfig.data.configuration.shell}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ==============================================================
               PROPOSAL REVIEW & VISUAL CONFIGURATION DIFF
               ============================================================== */
            <div className="mx-auto max-w-5xl flex flex-col gap-6">
              {/* Proposal Banner */}
              <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-6 shadow-[4px_4px_0px_#1E293B]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone[selectedProposal.status]}>
                        {statusLabel[selectedProposal.status]}
                      </Badge>
                      <span className="font-mono text-xs text-[#64748B]">
                        Proposal ID: {selectedProposal.id.slice(0, 8)}…
                      </span>
                    </div>
                    <h1 className="mt-1 font-['Outfit',sans-serif] text-2xl font-black text-[#0F172A]">
                      {selectedProposal.title}
                    </h1>
                    <p className="mt-1 text-xs text-[#64748B]">
                      Author: <strong className="text-[#0F172A]">{selectedProposal.createdByName}</strong> ·{" "}
                      {formatDateTime(selectedProposal.createdAt)}
                    </p>
                  </div>

                  {/* Actions Header */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Submit for approval */}
                    {selectedProposal.status === "validated" && (
                      <Button
                        variant="blue"
                        onClick={handleSubmitApproval}
                        loading={busyState === "submitting"}
                      >
                        Submit for Approval
                      </Button>
                    )}

                    {/* Approve / Reject */}
                    {selectedProposal.status === "pending_approval" && (
                      <>
                        <Button
                          variant="green"
                          onClick={() => handleDecision("approve")}
                          loading={busyState === "deciding"}
                        >
                          <ThumbsUp className="h-4 w-4" /> Approve Proposal
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => handleDecision("reject")}
                          loading={busyState === "deciding"}
                        >
                          <ThumbsDown className="h-4 w-4" /> Reject
                        </Button>
                      </>
                    )}

                    {/* Publish Release */}
                    {selectedProposal.status === "approved" && (
                      <Button
                        variant="primary"
                        onClick={handlePublish}
                        loading={busyState === "publishing"}
                        className="font-black uppercase"
                      >
                        <UploadCloud className="h-4 w-4" /> Publish Release
                      </Button>
                    )}

                    {selectedProposal.status === "published" && (
                      <Link
                        to={`/s/${selectedProposal.siteSlug}`}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border-2 border-[#1E293B] bg-[#34A853] px-4 text-xs font-bold text-white shadow-[3px_3px_0px_#1E293B] hover:bg-[#2D9247]"
                      >
                        Open Live Site &rarr;
                      </Link>
                    )}
                  </div>
                </div>

                {/* Original Prompt Quote */}
                <div className="mt-4 rounded-xl border-l-4 border-[#4285F4] bg-[#F8FAFC] p-3 text-xs italic text-[#334155]">
                  &ldquo;{selectedProposal.prompt}&rdquo;
                </div>
              </div>

              {/* Summary Metrics & Diff Highlights */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-xl border-2 border-[#1E293B] bg-white p-4 shadow-[3px_3px_0px_#1E293B]">
                  <span className="block text-[11px] font-bold text-[#64748B]">Modules Added</span>
                  <span className="font-mono text-xl font-black text-[#34A853]">
                    +{selectedProposal.diffSummary.modulesAdded.length}
                  </span>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-white p-4 shadow-[3px_3px_0px_#1E293B]">
                  <span className="block text-[11px] font-bold text-[#64748B]">Fields Created</span>
                  <span className="font-mono text-xl font-black text-[#4285F4]">
                    +{selectedProposal.diffSummary.fieldsAdded.length}
                  </span>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-white p-4 shadow-[3px_3px_0px_#1E293B]">
                  <span className="block text-[11px] font-bold text-[#64748B]">Capabilities Granted</span>
                  <span className="font-mono text-xl font-black text-[#FBBC04]">
                    +{selectedProposal.diffSummary.permissionsAdded.length}
                  </span>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-white p-4 shadow-[3px_3px_0px_#1E293B]">
                  <span className="block text-[11px] font-bold text-[#64748B]">Validation Status</span>
                  <span
                    className={`font-mono text-xs font-black ${
                      selectedProposal.validationResult.valid ? "text-[#34A853]" : "text-[#EA4335]"
                    }`}
                  >
                    {selectedProposal.validationResult.valid ? "PASSED (0 Errors)" : "FAILED CHECKS"}
                  </span>
                </div>
              </div>

              {/* AI Business Explanation */}
              <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-6 shadow-[4px_4px_0px_#1E293B]">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="h-4 w-4 text-[#4285F4]" />
                  <h3 className="font-['Outfit',sans-serif] text-sm font-black uppercase tracking-wider text-[#1E293B]">
                    Architectural &amp; Business Explanation
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-bold text-[#0F172A]">What Changes:</span>
                    <p className="mt-1 text-[#64748B]">
                      {selectedProposal.aiExplanation.whatChanges}
                    </p>
                  </div>
                  <div>
                    <span className="font-bold text-[#0F172A]">Why it Addresses Requirement:</span>
                    <p className="mt-1 text-[#64748B]">
                      {selectedProposal.aiExplanation.whyItAddressesPrompt}
                    </p>
                  </div>
                  <div>
                    <span className="font-bold text-[#0F172A]">Workflow &amp; Approval Impact:</span>
                    <p className="mt-1 text-[#64748B]">
                      {selectedProposal.aiExplanation.workflowImpact}
                    </p>
                  </div>
                  <div>
                    <span className="font-bold text-[#0F172A]">Security &amp; RLS Implication:</span>
                    <p className="mt-1 text-[#64748B]">
                      {selectedProposal.aiExplanation.securityImplications}
                    </p>
                  </div>
                </div>
              </div>

              {/* Structured Configuration Changes List */}
              <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-6 shadow-[4px_4px_0px_#1E293B]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-['Outfit',sans-serif] text-sm font-black uppercase tracking-wider text-[#1E293B]">
                    Detailed Configuration Changes ({selectedProposal.changes.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowJsonView(!showJsonView)}
                    className="font-mono text-xs font-bold text-[#4285F4] hover:underline"
                  >
                    {showJsonView ? "View Structured Cards" : "View Raw JSON Payload"}
                  </button>
                </div>

                {showJsonView ? (
                  <pre className="max-h-96 overflow-auto rounded-xl border border-[#CBD5E1] bg-[#0F172A] p-4 font-mono text-xs text-[#E2E8F0]">
                    {JSON.stringify(selectedProposal.proposedConfiguration, null, 2)}
                  </pre>
                ) : (
                  <div className="flex flex-col gap-2">
                    {selectedProposal.changes.map((c, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] p-3 shadow-[2px_2px_0px_#1E293B]"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                              c.operation === "add"
                                ? "bg-[#34A853]/20 text-[#34A853]"
                                : "bg-[#EA4335]/20 text-[#EA4335]"
                            }`}
                          >
                            {c.operation}
                          </span>
                          <span className="font-bold text-xs text-[#0F172A]">{c.target}</span>
                          <span className="text-xs text-[#64748B]">— {c.description}</span>
                        </div>
                        {c.severity === "security_sensitive" && (
                          <span className="flex items-center gap-1 rounded bg-[#EA4335]/10 px-2 py-0.5 text-[10px] font-bold text-[#EA4335]">
                            <ShieldAlert className="h-3 w-3" /> Security Sensitive
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Natural Language Refinement Form */}
              {selectedProposal.status !== "published" && (
                <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-6 shadow-[4px_4px_0px_#1E293B]">
                  <h3 className="font-['Outfit',sans-serif] text-sm font-black uppercase tracking-wider text-[#1E293B] mb-2">
                    Refine or Adjust this Proposal
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={refinementPrompt}
                      onChange={(e) => setRefinementPrompt(e.target.value)}
                      placeholder='e.g. "Add supervisor approval before return can be confirmed"'
                      className="flex-1 rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] px-3 font-['Outfit',sans-serif] text-xs font-medium text-[#0F172A] shadow-[2px_2px_0px_#1E293B] focus:border-[#4285F4] focus:outline-none"
                    />
                    <Button
                      variant="primary"
                      disabled={!refinementPrompt.trim() || Boolean(busyState)}
                      loading={busyState === "refining"}
                      onClick={handleRefine}
                      className="font-black uppercase"
                    >
                      Refine Proposal
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
