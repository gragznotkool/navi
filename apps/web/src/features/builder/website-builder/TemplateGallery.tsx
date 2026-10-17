import { ExternalLink, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { DeployedWebsite, WebsiteTemplate } from "@opshub/contracts";
import { AccessDialog } from "./AccessControl";
import { TemplateCard } from "./TemplateCard";

export function TemplateGallery({ templates, query, selectedId, onSelect }: { templates: readonly WebsiteTemplate[]; query: string; selectedId: string | null; onSelect: (t: WebsiteTemplate) => void }) {
  const q = query.trim().toLowerCase();
  const shown = templates.filter((t) => !q || [t.name, t.tagline, t.description, t.theme.shell, ...t.modules].some((s) => s.toLowerCase().includes(q)));
  if (shown.length === 0) return <p className="px-1 py-6 text-center text-xs text-[#A5A8A6]">No templates match “{query}”.</p>;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {shown.map((t) => (
        <TemplateCard key={t.id} template={t} selected={t.id === selectedId} onSelect={() => onSelect(t)} />
      ))}
    </div>
  );
}

/** Websites this admin has deployed, with quick links and access management. */
export function DeployedWebsites({ websites, onChanged }: { websites: readonly DeployedWebsite[]; onChanged: () => void }) {
  const [managing, setManaging] = useState<DeployedWebsite | null>(null);
  if (websites.length === 0) return null;
  return (
    <section className="mt-5 border-t-2 border-[#1E293B] pt-4" aria-label="Live websites">
      <h3 className="mb-2 px-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">Live websites · {websites.length}</h3>
      <ul className="flex flex-col gap-2">
        {websites.map((w) => (
          <li key={w.id} className="flex items-center gap-2 rounded-xl border-2 border-[#1E293B] bg-white px-3 py-2 shadow-[2px_2px_0px_#1E293B]">
            <span aria-hidden className="h-6 w-2 shrink-0 rounded-full border border-[#1E293B]" style={{ background: w.primary }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-[#0F172A]">{w.name}</span>
              <span className="block truncate font-mono text-[10px] text-slate-500 font-medium">{w.path} · {w.themeName}</span>
            </span>
            <button type="button" onClick={() => setManaging(w)} title="Manage access" aria-label={`Manage access to ${w.name}`} className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#1E293B] bg-slate-50 px-2 text-[11px] font-bold text-[#0F172A] hover:bg-[#FBBC04]">
              <Users className="h-3.5 w-3.5" aria-hidden /> {w.memberCount}
            </button>
            <Link to={w.path} title="Open website" aria-label={`Open ${w.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[1px_1px_0px_#1E293B]">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {managing && (
        <AccessDialog
          website={managing}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
