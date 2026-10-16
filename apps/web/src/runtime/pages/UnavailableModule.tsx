import { Info } from "lucide-react";
import { PageHeader } from "../../components/ui";

/** Honest placeholder for a module that is enabled by configuration but not implemented yet. */
export function UnavailableModule({ title, reason }: { title: string; reason: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div role="status" className="flex items-start gap-2 rounded-ui border border-line bg-surface p-4">
        <Info className="mt-0.5 h-4 w-4 text-info" aria-hidden />
        <div>
          <p className="text-sm font-medium">Not implemented yet</p>
          <p className="mt-0.5 text-sm text-muted">{reason}</p>
        </div>
      </div>
    </>
  );
}
