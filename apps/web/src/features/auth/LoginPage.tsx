import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { loginRequestSchema, type LoginRequest } from "@opshub/contracts";
import { Button, TextField } from "../../components/ui";
import { toRequestError } from "../../lib/api";
import { useSession } from "../../stores/session";
import { useState } from "react";

/** Only same-app paths are honoured, so a crafted link cannot redirect a user off-site after login. */
function safeReturnPath(v: unknown): string {
  return typeof v === "string" && /^\/(?!\/)/.test(v) && !v.startsWith("/login") ? v : "/";
}

export function LoginPage() {
  const { status, login } = useSession();
  const navigate = useNavigate();
  const from = safeReturnPath((useLocation().state as { from?: unknown } | null)?.from);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });

  if (status === "authenticated") return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (e) {
      setServerError(toRequestError(e).message);
    }
  });

  return (
    <main className="grid min-h-full lg:grid-cols-12 bg-[#080909] text-[#F5F5F0]">
      {/* Brand Panel (Industrial Technical Command) */}
      <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between border-r border-[#303432] bg-[#0c0e0e] p-12 overflow-hidden industrial-grid-bg">
        {/* Subtle decorative technical overlay elements */}
        <div className="absolute top-0 left-0 w-full h-1 bg-[#FFE500]" />
        <div className="absolute top-8 right-8 font-mono text-[10px] tracking-widest text-[#777C79] uppercase">
          SYS_ID: OPS-HUB-V2 // 52.3702° N, 4.8952° E
        </div>

        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[3px] bg-[#FFE500] font-black text-[#080909] text-base shadow-[0_0_15px_rgba(255,229,0,0.35)]">
              OH
            </div>
            <div className="flex flex-col">
              <span className="font-['Barlow_Condensed',sans-serif] text-xl font-black uppercase tracking-widest text-[#F5F5F0]">
                OpsHub Command
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#A5A8A6]">
                Multi-Business Operations Fleet
              </span>
            </div>
          </div>
        </div>

        <div className="my-auto py-12 max-w-lg">
          <div className="mb-4 inline-flex items-center gap-2 rounded-[2px] border border-[#FFE500]/40 bg-[#FFE500]/10 px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest text-[#FFE500]">
            <span className="h-1.5 w-1.5 bg-[#FFE500]" />
            ENTERPRISE LOGISTICS & WORKFLOW CONTROL
          </div>
          <h1 className="font-['Barlow_Condensed',sans-serif] text-6xl font-black uppercase leading-[0.9] tracking-tight text-[#F5F5F0]">
            ALL OPERATIONS.<br />
            <span className="text-[#FFE500]">ONE COMMAND HUB.</span>
          </h1>
          <p className="mt-4 font-mono text-xs uppercase tracking-wider text-[#A5A8A6] border-l-2 border-[#FFE500] pl-3">
            STORES / SERVICE CENTRE / DISTRIBUTION
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[#777C79]">
            Unified runtime for multi-tenant inventory ledgering, automated approval routing, precision material assignment, and real-time operational telemetry.
          </p>
        </div>

        {/* Technical annotation metadata bar */}
        <div className="flex items-center justify-between border-t border-[#303432] pt-4 font-mono text-[10px] text-[#777C79] uppercase">
          <div className="flex items-center gap-4">
            <span>ISOLATION: STRICT RLS</span>
            <span>·</span>
            <span>ENCRYPTION: AES-256</span>
            <span>·</span>
            <span>TELEMETRY: LIVE</span>
          </div>
          <div className="text-[#FFE500]">STATUS: OPERATIONAL</div>
        </div>
      </div>

      {/* Authentication Panel */}
      <div className="flex lg:col-span-5 flex-col justify-center items-center p-6 sm:p-12 bg-[#080909]">
        <div className="w-full max-w-sm">
          {/* Mobile brand mark */}
          <div className="mb-8 lg:hidden text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#FFE500] text-[#080909] font-black shadow-md">
              OH
            </div>
            <h1 className="font-['Barlow_Condensed',sans-serif] text-2xl font-black uppercase tracking-wider text-[#F5F5F0]">OpsHub Command</h1>
            <p className="font-mono text-[10px] text-[#A5A8A6] uppercase tracking-wider">Stores / Service / Distribution</p>
          </div>

          <div className="mb-6">
            <h2 id="login-title" className="font-['Barlow_Condensed',sans-serif] text-3xl font-black uppercase tracking-wider text-[#F5F5F0]">
              AUTHENTICATE <span className="text-[#FFE500]">OPERATOR</span>
            </h2>
            <p className="mt-1 font-mono text-xs uppercase tracking-wider text-[#A5A8A6]">
              Enter authorized credentials to access unit workspaces.
            </p>
          </div>

          <form onSubmit={onSubmit} noValidate aria-labelledby="login-title" className="rounded-[4px] border border-[#303432] bg-[#171919] p-6 shadow-2xl">
            {serverError && (
              <div role="alert" className="mb-4 rounded-[2px] border border-[#FF5C5C]/50 bg-[#FF5C5C]/10 p-3 font-mono text-xs text-[#FF5C5C]">
                {serverError}
              </div>
            )}
            <div className="flex flex-col gap-4">
              <TextField label="OPERATOR IDENTIFIER (EMAIL)" type="email" autoComplete="username" error={formState.errors.email?.message} {...register("email")} />
              <TextField label="SECURITY ACCESS TOKEN (PASSWORD)" type="password" autoComplete="current-password" error={formState.errors.password?.message} {...register("password")} />
              <Button type="submit" variant="primary" loading={formState.isSubmitting} className="w-full mt-2 py-2.5 font-bold tracking-widest text-xs">
                SIGN IN TO OPS COMMAND →
              </Button>
            </div>
            {import.meta.env.DEV && (
              <div className="mt-6 border-t border-[#303432] pt-3 text-center">
                <p className="font-mono text-[10px] text-[#777C79] uppercase">
                  Dev Master Key: <code className="text-[#FFE500]">docs/demo-runbook.md</code>
                </p>
              </div>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
