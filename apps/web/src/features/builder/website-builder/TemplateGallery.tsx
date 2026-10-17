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
    <section className="mt-5 border-t border-[#303432] pt-4" aria-label="Live websites">
      <h3 className="mb-2 px-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#777C79]">Live websites · {websites.length}</h3>
      <ul className="flex flex-col gap-1.5">
        {websites.map((w) => (
          <li key={w.id} className="flex items-center gap-2 rounded-[3px] border border-[#303432] bg-[#171919] px-2.5 py-2">
            <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: w.primary }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-[#F5F5F0]">{w.name}</span>
              <span className="block truncate font-mono text-[10px] text-[#A5A8A6]">{w.path} · {w.themeName}</span>
            </span>
            <button type="button" onClick={() => setManaging(w)} title="Manage access" aria-label={`Manage access to ${w.name}`} className="inline-flex h-7 items-center gap-1 rounded-[3px] px-1.5 text-[11px] text-[#A5A8A6] hover:bg-[#1f2222] hover:text-[#F5F5F0]">
              <Users className="h-3.5 w-3.5" aria-hidden /> {w.memberCount}
            </button>
            <Link to={w.path} title="Open website" aria-label={`Open ${w.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-[#FFE500] hover:bg-[#FFE500]/10">
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
