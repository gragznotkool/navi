import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { loginRequestSchema, type LoginRequest } from "@opshub/contracts";
import { Button, TextField } from "../../components/ui";
import { toRequestError } from "../../lib/api";
import { useSession } from "../../stores/session";
import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";

/** Only same-app paths are honoured, so a crafted link cannot redirect a user off-site after login. */
function safeReturnPath(v: unknown): string {
  return typeof v === "string" && /^\/(?!\/)/.test(v) && !v.startsWith("/login") ? v : "/";
}

export function LoginPage() {
  const { status, login } = useSession();
  const navigate = useNavigate();
  const from = safeReturnPath((useLocation().state as { from?: unknown } | null)?.from);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="relative min-h-screen grid lg:grid-cols-12 bg-[#080909] text-[#F5F5F0] overflow-hidden">
      {/* Subtle background radial glow around the central divider */}
      <div
        className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-[#FFE500]/5 blur-3xl"
        aria-hidden="true"
      />

      {/* Brand Panel (54% on desktop) */}
      <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between border-r border-[#303432] bg-[#0c0e0e] p-10 xl:p-14 overflow-hidden industrial-grid-bg">
        {/* Top hazard accent line */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-[#FFE500] via-[#FFE500]/60 to-transparent" />

        {/* Top Header Section */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#FFE500] font-black text-[#080909] text-lg shadow-[0_0_20px_rgba(255,229,0,0.3)]">
              OH
            </div>
            <div className="flex flex-col">
              <span className="font-['Barlow_Condensed',sans-serif] text-xl font-black uppercase tracking-wider text-[#F5F5F0]">
                OpsHub <span className="text-[#FFE500]">Command</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#777C79]">
                MULTI-SITE OPERATIONS FLEET
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-[2px] border border-[#303432] bg-[#111313] px-2.5 py-1 font-mono text-[10px] text-[#A5A8A6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#39D98A] animate-pulse" />
            <span className="uppercase text-[#777C79]">SYSTEM:</span>
            <span className="text-[#F5F5F0]">ONLINE</span>
          </div>
        </div>

        {/* Central Hero Block */}
        <div className="my-auto py-8 max-w-xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-[2px] border border-[#FFE500]/30 bg-[#FFE500]/10 px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest text-[#FFE500]">
            <span className="h-1.5 w-1.5 bg-[#FFE500]" />
            INDUSTRIAL CONTROL SYSTEM
          </div>

          <h1 className="font-['Barlow_Condensed',sans-serif] text-6xl xl:text-7xl font-black uppercase leading-[0.92] tracking-tight text-[#F5F5F0]">
            ALL OPERATIONS.<br />
            <span className="text-[#FFE500]">ONE HUB.</span>
          </h1>

          <div className="mt-4 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#A5A8A6]">
            <span className="h-4 w-[2px] bg-[#FFE500]" />
            <span>STORES</span>
            <span className="text-[#303432]">/</span>
            <span>SERVICE CENTRE</span>
            <span className="text-[#303432]">/</span>
            <span>DISTRIBUTION</span>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[#A5A8A6] max-w-md">
            Direct operational control for inventory ledgering, automated approval routing, precision material assignment, and real-time site telemetry.
          </p>

          {/* Technical Operations Schematic SVG */}
          <div className="mt-6 rounded-[3px] border border-[#303432] bg-[#111313]/90 p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between border-b border-[#242826] pb-2 font-mono text-[10px] text-[#777C79] uppercase">
              <span>// MULTI-SITE TOPOLOGY SCHEMATIC</span>
              <span className="text-[#FFE500]">ISOLATED RLS CELLS</span>
            </div>
            <svg
              viewBox="0 0 460 90"
              className="w-full text-[#A5A8A6]"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Connection lines */}
              <path d="M 90 45 L 200 45" stroke="#303432" strokeWidth="1.5" strokeDasharray="3 3" />
              <path d="M 260 45 L 370 45" stroke="#303432" strokeWidth="1.5" strokeDasharray="3 3" />
              <path d="M 190 20 L 270 20" stroke="#FFE500" strokeWidth="1" strokeOpacity="0.4" />

              {/* Node 1: Central Stores */}
              <rect x="10" y="20" width="80" height="50" rx="3" fill="#171919" stroke="#303432" strokeWidth="1.5" />
              <rect x="10" y="20" width="80" height="4" fill="#FFE500" />
              <text x="50" y="42" fill="#F5F5F0" fontSize="10" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" textAnchor="middle" letterSpacing="0.05em">CENTRAL STORES</text>
              <text x="50" y="56" fill="#777C79" fontSize="8" fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">STOCK & LEDGER</text>

              {/* Central Router / OpsHub Engine */}
              <circle cx="230" cy="45" r="28" fill="#171919" stroke="#FFE500" strokeWidth="2" strokeDasharray="2 2" />
              <circle cx="230" cy="45" r="22" fill="#080909" />
              <text x="230" y="42" fill="#FFE500" fontSize="11" fontFamily="'Barlow Condensed', sans-serif" fontWeight="900" textAnchor="middle">OPSHUB</text>
              <text x="230" y="54" fill="#A5A8A6" fontSize="7" fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">RUNTIME</text>

              {/* Node 2: Service & Distribution */}
              <rect x="370" y="20" width="80" height="50" rx="3" fill="#171919" stroke="#303432" strokeWidth="1.5" />
              <rect x="370" y="20" width="80" height="4" fill="#FFE500" />
              <text x="410" y="42" fill="#F5F5F0" fontSize="10" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" textAnchor="middle" letterSpacing="0.05em">DISTRIBUTION</text>
              <text x="410" y="56" fill="#777C79" fontSize="8" fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">DISPATCH HUB</text>
            </svg>
          </div>
        </div>

        {/* Technical Annotation Footer */}
        <div className="flex items-center justify-between border-t border-[#303432] pt-4 font-mono text-[10px] text-[#777C79] uppercase">
          <div className="flex items-center gap-3">
            <span>ISOLATION: STRICT RLS</span>
            <span>·</span>
            <span>ENCRYPTION: AES-256</span>
            <span>·</span>
            <span>TELEMETRY: ACTIVE</span>
          </div>
          <span className="text-[#A5A8A6]">AUTH_VERSION: 2.4.1</span>
        </div>
      </div>

      {/* Authentication Panel (46% on desktop) */}
      <div className="flex lg:col-span-5 flex-col justify-center items-center p-6 sm:p-12 lg:p-14 bg-[#080909]">
        <div className="w-full max-w-[420px]">
          {/* Mobile brand mark */}
          <div className="mb-6 lg:hidden text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#FFE500] text-[#080909] font-black shadow-md">
              OH
            </div>
            <h1 className="font-['Barlow_Condensed',sans-serif] text-2xl font-black uppercase tracking-wider text-[#F5F5F0]">
              OpsHub Command
            </h1>
            <p className="font-mono text-[10px] text-[#A5A8A6] uppercase tracking-wider">
              Stores / Service / Distribution
            </p>
          </div>

          {/* Form Header */}
          <div className="mb-6">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-1.5 w-1.5 bg-[#FFE500]" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#A5A8A6]">OPERATOR ACCESS CONTROL</span>
            </div>
            <h2 id="login-title" aria-label="Sign in to OpsHub" className="font-['Barlow_Condensed',sans-serif] text-3xl font-black uppercase tracking-wider text-[#F5F5F0]">
              AUTHENTICATE <span className="text-[#FFE500]">OPERATOR</span>
            </h2>
            <p className="mt-1 text-xs text-[#A5A8A6]">
              Enter authorized credentials to access unit workspaces.
            </p>
          </div>

          {/* Login Card Form */}
          <form
            onSubmit={onSubmit}
            noValidate
            aria-labelledby="login-title"
            className="rounded-[4px] border border-[#303432] bg-[#171919] p-6 sm:p-7 shadow-2xl relative"
          >
            {/* Corner technical tick marks */}
            <div className="absolute top-1.5 left-1.5 h-1.5 w-1.5 border-t border-l border-[#FFE500]/60" />
            <div className="absolute top-1.5 right-1.5 h-1.5 w-1.5 border-t border-r border-[#FFE500]/60" />
            <div className="absolute bottom-1.5 left-1.5 h-1.5 w-1.5 border-b border-l border-[#FFE500]/60" />
            <div className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 border-b border-r border-[#FFE500]/60" />

            {serverError && (
              <div role="alert" className="mb-4 rounded-[2px] border border-[#FF5C5C]/50 bg-[#FF5C5C]/10 p-3 font-mono text-xs text-[#FF5C5C]">
                {serverError}
              </div>
            )}

            <div className="flex flex-col gap-4">
              <TextField
                label="Email"
                type="email"
                autoComplete="username"
                placeholder="operator@opshub.local"
                error={formState.errors.email?.message}
                {...register("email")}
              />

              <TextField
                label="Password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••••••"
                error={formState.errors.password?.message}
                rightAction={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="p-1 text-[#777C79] hover:text-[#FFE500] transition"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
                {...register("password")}
              />

              <Button
                type="submit"
                variant="primary"
                loading={formState.isSubmitting}
                className="w-full mt-2 h-11 text-xs font-bold tracking-widest uppercase transition-all duration-200"
              >
                <span>Sign in</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
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

          {/* Discreet Help Info */}
          <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-[#777C79]">
            <span>Need access clearance?</span>
            <span className="text-[#A5A8A6] hover:text-[#FFE500] cursor-pointer transition">Contact Site Administrator</span>
          </div>
        </div>
      </div>
    </main>
  );
}
