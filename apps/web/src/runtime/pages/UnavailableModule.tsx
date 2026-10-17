import { Info } from "lucide-react";
import { PageHeader } from "../../components/ui";

/** Honest placeholder for a module that is enabled by configuration but not implemented yet. */
export function UnavailableModule({ title, reason }: { title: string; reason: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div role="status" className="flex items-start gap-3 rounded-2xl border-2 border-[#1E293B] bg-white p-5 shadow-[4px_4px_0px_#1E293B]">
        <Info className="mt-0.5 h-5 w-5 text-[#4285F4] shrink-0" aria-hidden />
        <div>
          <p className="font-['Outfit',sans-serif] text-base font-extrabold text-[#0F172A]">Not implemented yet</p>
          <p className="mt-1 text-sm font-medium text-slate-600">{reason}</p>
        </div>
      </div>
    </>
  );
}
