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
      className={`group relative flex w-full flex-col overflow-hidden rounded-[3px] border bg-[#171919] text-left transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.015] hover:shadow-[0_10px_24px_-12px_rgba(0,0,0,0.6)] focus-visible:outline-none ${
        selected ? "border-[#FFE500] shadow-[0_0_0_3px_rgba(255,229,0,0.18)]" : "border-[#303432]"
      }`}
    >
      <div className="p-2 pb-0">
        <WebsitePreview theme={t} siteName={template.name} pages={template.modules.length ? ["Dashboard", ...template.modules] : undefined} className="ring-1 ring-[#303432]" />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2.5 pb-3 pt-2">
        <span className="flex items-center gap-1.5 font-['Barlow_Condensed',sans-serif] uppercase tracking-wider text-[13px] font-bold leading-tight text-[#F5F5F0]">
          <span aria-hidden>{THEME_EMOJI[t.id] ?? "✨"}</span>
          {template.name}
        </span>
        <span className="line-clamp-2 text-[11px] leading-snug text-[#A5A8A6]">{template.tagline} · {template.description}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-[3px] bg-[#202422] px-1.5 py-0.5 text-[10px] font-semibold text-[#F5F5F0]">{template.moduleCount} modules</span>
          <span className="rounded-[3px] bg-[#202422] px-1.5 py-0.5 text-[10px] font-medium text-[#A5A8A6]">{SHELL_LABEL[t.shell]}</span>
        </span>
      </div>
      <span aria-hidden className="h-1 w-full" style={{ background: t.palette.primary }} />
      {selected && (
        <span className="ws-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#FFE500] text-[#080909]">
          <Check className="h-3 w-3" aria-hidden />
        </span>
      )}
    </button>
  );
}
