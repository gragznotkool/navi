import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-[#FFE500] text-[#080909] font-bold hover:bg-[#E8D000] shadow-[0_0_15px_rgba(255,229,0,0.2)] active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-[#FFE500]",
  secondary:
    "border border-[#303432] bg-[#171919] text-[#F5F5F0] hover:bg-[#202422] hover:border-[#424845] disabled:opacity-40",
  outline:
    "border border-[#FFE500] bg-transparent text-[#FFE500] hover:bg-[#FFE500]/10 disabled:opacity-40",
  danger:
    "bg-[#FF5C5C] text-[#080909] font-bold hover:brightness-110 disabled:opacity-40",
  ghost:
    "text-[#A5A8A6] hover:bg-[#171919] hover:text-[#F5F5F0] disabled:opacity-40",
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
      className={`group relative inline-flex h-10 items-center justify-center gap-2 rounded-[3px] px-4 text-xs font-semibold tracking-wider uppercase transition-all duration-150 disabled:cursor-not-allowed select-none ${variants[variant]} ${className}`}
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
  "h-10 w-full rounded-[3px] border border-[#303432] bg-[#111313] px-3 text-sm text-[#F5F5F0] placeholder:text-[#777C79] transition-all focus:border-[#FFE500] focus:ring-1 focus:ring-[#FFE500] focus:bg-[#151717] disabled:bg-[#080909] disabled:opacity-50 aria-[invalid=true]:border-[#FF5C5C]";

export const TextField = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, error, hint, rightAction, className = "", ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block font-mono text-[11px] font-semibold tracking-wider uppercase text-[#A5A8A6]">
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
      {hint && !error && <p className="mt-1 font-mono text-[11px] text-[#777C79]">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 font-mono text-[11px] text-[#FF5C5C]">
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
      <label htmlFor={id} className="mb-1 block font-mono text-[11px] font-semibold tracking-wider uppercase text-[#A5A8A6]">
        {label}
      </label>
      <select ref={ref} id={id} aria-invalid={error ? true : undefined} className={inputClass} {...rest}>
        {children}
      </select>
      {error && (
        <p role="alert" className="mt-1 font-mono text-[11px] text-[#FF5C5C]">
          {error}
        </p>
      )}
    </div>
  );
});

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "yellow";
const tones: Record<Tone, string> = {
  neutral: "border border-[#303432] bg-[#111313] text-[#A5A8A6]",
  yellow: "border border-[#FFE500]/40 bg-[#FFE500]/10 text-[#FFE500] font-bold",
  success: "border border-[#39D98A]/30 bg-[#39D98A]/10 text-[#39D98A]",
  warning: "border border-[#FFB547]/30 bg-[#FFB547]/10 text-[#FFB547]",
  danger: "border border-[#FF5C5C]/30 bg-[#FF5C5C]/10 text-[#FF5C5C]",
  info: "border border-[#63B3ED]/30 bg-[#63B3ED]/10 text-[#63B3ED]",
};

/** Status is always conveyed by text, never colour alone. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-[2px] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase ${tones[tone]}`}>{children}</span>;
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-[#303432] pb-4">
      <div>
        <h1 className="font-['Barlow_Condensed',sans-serif] text-2xl font-black uppercase tracking-wider text-[#F5F5F0]">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-[#A5A8A6]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-[4px] border border-[#303432] bg-[#171919] shadow-md">
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-[#303432] bg-[#111313] px-4 py-3">
          <h2 className="font-['Barlow_Condensed',sans-serif] text-sm font-bold uppercase tracking-wider text-[#F5F5F0]">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
