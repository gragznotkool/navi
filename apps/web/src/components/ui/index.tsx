import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline" | "blue" | "green";

const variants: Record<Variant, string> = {
  primary:
    "border-2 border-[#1E293B] bg-[#FBBC04] text-[#0F172A] font-bold hover:bg-[#F59E0B] shadow-[3px_3px_0px_#1E293B] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_#1E293B] disabled:opacity-40",
  secondary:
    "border-2 border-[#1E293B] bg-[#FFFFFF] text-[#0F172A] font-semibold hover:bg-[#F8FAFC] shadow-[3px_3px_0px_#1E293B] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_#1E293B] disabled:opacity-40",
  outline:
    "border-2 border-[#1E293B] bg-transparent text-[#1E293B] font-bold hover:bg-white/20 shadow-[2px_2px_0px_#1E293B] disabled:opacity-40",
  danger:
    "border-2 border-[#1E293B] bg-[#EA4335] text-white font-bold hover:bg-[#D93025] shadow-[3px_3px_0px_#1E293B] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_#1E293B] disabled:opacity-40",
  blue:
    "border-2 border-[#1E293B] bg-[#4285F4] text-white font-bold hover:bg-[#3367D6] shadow-[3px_3px_0px_#1E293B] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_#1E293B] disabled:opacity-40",
  green:
    "border-2 border-[#1E293B] bg-[#34A853] text-white font-bold hover:bg-[#2D9247] shadow-[3px_3px_0px_#1E293B] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_#1E293B] disabled:opacity-40",
  ghost:
    "text-[#475569] hover:bg-black/5 hover:text-[#0F172A] font-semibold disabled:opacity-40",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({ variant = "secondary", loading, disabled, children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`group relative inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold tracking-wide transition-all duration-100 disabled:cursor-not-allowed select-none ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  rightAction?: ReactNode;
}

const inputClass =
  "h-10 w-full rounded-xl border-2 border-[#1E293B] bg-white px-3 text-sm font-medium text-[#0F172A] placeholder:text-[#94A3B8] shadow-[2px_2px_0px_#1E293B] transition-all focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/30 focus:shadow-[3px_3px_0px_#1E293B] disabled:bg-slate-100 disabled:opacity-60 aria-[invalid=true]:border-[#EA4335]";

export const TextField = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, error, hint, rightAction, className = "", ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A]">
        {label}
      </label>
      <div className="relative">
        <input ref={ref} id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} className={`${inputClass} ${rightAction ? "pr-10" : ""}`} {...rest} />
        {rightAction && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2.5">
            {rightAction}
          </div>
        )}
      </div>
      {hint && !error && <p className="mt-1 text-[11px] text-[#64748B]">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 font-bold text-[11px] text-[#EA4335]">
          {error}
        </p>
      )}
    </div>
  );
});

export const SelectField = forwardRef<HTMLSelectElement, FieldProps & SelectHTMLAttributes<HTMLSelectElement>>(function SelectField(
  { label, error, children, className = "", ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A]">
        {label}
      </label>
      <select ref={ref} id={id} aria-invalid={error ? true : undefined} className={inputClass} {...rest}>
        {children}
      </select>
      {error && (
        <p role="alert" className="mt-1 font-bold text-[11px] text-[#EA4335]">
          {error}
        </p>
      )}
    </div>
  );
});

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "yellow";
const tones: Record<Tone, string> = {
  neutral: "border-2 border-[#1E293B] bg-slate-100 text-[#334155]",
  yellow: "border-2 border-[#1E293B] bg-[#FBBC04] text-[#0F172A]",
  success: "border-2 border-[#1E293B] bg-[#34A853] text-white",
  warning: "border-2 border-[#1E293B] bg-[#FBBC04] text-[#0F172A]",
  danger: "border-2 border-[#1E293B] bg-[#EA4335] text-white",
  info: "border-2 border-[#1E293B] bg-[#4285F4] text-white",
};

/** Status is always conveyed by text, never colour alone. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-bold text-[11px] tracking-wide shadow-[1px_1px_0px_#1E293B] ${tones[tone]}`}>{children}</span>;
}

const statusTone: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  assigned: "yellow",
  fulfilled: "success",
  cancelled: "neutral",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{status}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-2xl border-2 border-[#1E293B] bg-white p-4 shadow-[4px_4px_0px_#1E293B]">
      <div>
        <h1 className="font-['Outfit',sans-serif] text-2xl font-extrabold tracking-tight text-[#0F172A]">{title}</h1>
        {subtitle && <p className="mt-1 text-xs font-medium text-[#64748B]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, actions }: { title?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[#1E293B] bg-white shadow-[4px_4px_0px_#1E293B] overflow-hidden">
      {(title || actions) && (
        <header className="flex items-center justify-between border-b-2 border-[#1E293B] bg-slate-50 px-4 py-3">
          <h2 className="font-['Outfit',sans-serif] text-sm font-bold tracking-tight text-[#0F172A]">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4 text-[#0F172A]">{children}</div>
    </section>
  );
}

