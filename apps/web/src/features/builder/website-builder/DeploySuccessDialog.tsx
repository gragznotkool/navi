import { Check, Copy, ExternalLink, Rocket } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "./Dialog";

const CONFETTI = ["#FFE500", "#39D98A", "#FFB547", "#FF5C5C", "#0EA5E9", "#EC4899"];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (http, old browser): fall back to a temporary selection.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand?.("copy") ?? false;
    el.remove();
    return ok;
  }
}

export function DeploySuccessDialog({ name, path, onClose, onDeployAnother }: { name: string; path: string; onClose: () => void; onDeployAnother: () => void }) {
  const url = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2;
        const dist = 70 + ((i * 37) % 50);
        return { color: CONFETTI[i % CONFETTI.length]!, dx: `${Math.round(Math.cos(angle) * dist)}px`, dy: `${Math.round(Math.sin(angle) * dist)}px`, rot: `${(i * 67) % 360}deg`, delay: `${(i % 6) * 25}ms` };
      }),
    [],
  );

  return (
    <Dialog label="Website created" onClose={onClose}>
      <div className="px-7 pb-7 pt-9 text-center">
        <div className="relative mx-auto h-16 w-16">
          {pieces.map((p, i) => (
            <span key={i} aria-hidden className="ws-confetti absolute left-1/2 top-1/2 h-2 w-1.5 rounded-sm" style={{ background: p.color, ["--dx" as string]: p.dx, ["--dy" as string]: p.dy, ["--rot" as string]: p.rot, animationDelay: p.delay }} />
          ))}
          <span className="ws-pop relative flex h-16 w-16 items-center justify-center rounded-full bg-[#39D98A] text-[#080909] shadow-[0_10px_30px_-8px_rgba(57,217,138,0.45)]">
            <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
          </span>
        </div>
        <h2 className="mt-5 font-['Barlow_Condensed',sans-serif] uppercase tracking-wider text-2xl font-bold">Website created!</h2>
        <p className="mt-1 text-sm text-[#A5A8A6]">
          <strong className="font-semibold text-[#F5F5F0]">{name}</strong> is live and accessible at:
        </p>
        <div className="mt-4 flex items-center gap-1 rounded-[3px] border border-[#303432] bg-[#111313] p-1.5 pl-3">
          <code className="min-w-0 flex-1 truncate text-left font-mono text-sm text-[#F5F5F0]" data-testid="website-url">{url}</code>
          <button
            type="button"
            onClick={async () => {
              setCopied(await copyText(url));
              setTimeout(() => setCopied(false), 1800);
            }}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] px-3 text-xs font-semibold transition-colors ${copied ? "bg-[#39D98A] text-[#080909]" : "bg-[#171919] text-[#F5F5F0] ring-1 ring-[#303432] hover:bg-[#1f2222]"}`}
            aria-live="polite"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy URL"}
          </button>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to={path} className="inline-flex h-10 items-center gap-2 rounded-[3px] bg-[#FFE500] px-4 text-sm font-semibold text-[#080909] hover:bg-[#E8D000]">
            Open site <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
          <button type="button" onClick={onDeployAnother} className="inline-flex h-10 items-center gap-2 rounded-[3px] border border-[#303432] bg-[#171919] px-4 text-sm font-semibold text-[#F5F5F0] hover:bg-[#1f2222]">
            <Rocket className="h-4 w-4" aria-hidden /> Deploy another
          </button>
        </div>
      </div>
    </Dialog>
  );
}
