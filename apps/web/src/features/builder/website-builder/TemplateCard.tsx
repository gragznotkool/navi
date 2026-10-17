import { Check } from "lucide-react";
import type { WebsiteTemplate } from "@opshub/contracts";
import { THEME_EMOJI } from "./themes";
import { WebsitePreview } from "./WebsitePreview";

const SHELL_LABEL = { sidebar: "Sidebar", topbar: "Topbar", workbench: "Workbench" } as const;

export function TemplateCard({ template, selected, onSelect }: { template: WebsiteTemplate; selected: boolean; onSelect: () => void }) {
  const t = template.theme;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`template-${template.id}`}
      className={`group relative flex w-full flex-col overflow-hidden rounded-xl border-2 bg-white text-left transition-all duration-150 hover:-translate-y-0.5 shadow-[2px_2px_0px_#1E293B] hover:shadow-[4px_4px_0px_#1E293B] focus-visible:outline-none ${
        selected ? "border-[#1E293B] ring-2 ring-[#FBBC04]" : "border-[#1E293B]"
      }`}
    >
      <div className="p-2 pb-0">
        <WebsitePreview theme={t} siteName={template.name} pages={template.modules.length ? ["Dashboard", ...template.modules] : undefined} className="ring-1 ring-slate-200 rounded-lg overflow-hidden" />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2.5 pb-3 pt-2">
        <span className="flex items-center gap-1.5 font-['Outfit',sans-serif] uppercase tracking-wider text-[13px] font-extrabold leading-tight text-[#0F172A]">
          <span aria-hidden>{THEME_EMOJI[t.id] ?? "✨"}</span>
          {template.name}
        </span>
        <span className="line-clamp-2 text-[11px] leading-snug text-slate-500 font-medium">{template.tagline} · {template.description}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-md border border-[#1E293B] bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-[#0F172A]">{template.moduleCount} modules</span>
          <span className="rounded-md border border-[#1E293B] bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{SHELL_LABEL[t.shell]}</span>
        </span>
      </div>
      <span aria-hidden className="h-1.5 w-full" style={{ background: t.palette.primary }} />
      {selected && (
        <span className="ws-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[1px_1px_0px_#1E293B]">
          <Check className="h-3 w-3" aria-hidden />
        </span>
      )}
    </button>
  );
}
