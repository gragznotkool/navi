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
  const { register, handleSubmit, formState, setValue } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });

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
    <main className="relative min-h-screen grid lg:grid-cols-12 bg-[#3B82F6] overflow-x-hidden selection:bg-[#FBBC04] selection:text-[#0F172A]">
      {/* Playful polka-dot background pattern */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.3)_1.5px,transparent_1.5px)] [background-size:24px_24px] z-0"
        aria-hidden="true"
      />


      <div className="pointer-events-none absolute bottom-12 left-10 z-0 hidden lg:block -rotate-6">
        <div className="flex items-center gap-2 rounded-2xl border-2 border-[#1E293B] bg-[#34A853] p-3 text-xs font-black text-white shadow-[4px_4px_0px_#1E293B]">
          <span>⚡ MULTI-SITE FLEET</span>
        </div>
      </div>

      {/* Brand Hero Panel (54% on desktop) */}
      <div className="relative z-10 hidden lg:flex lg:col-span-7 flex-col justify-between p-10 xl:p-14 overflow-hidden">
        {/* Top Header Section */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5 bg-white border-2 border-[#1E293B] px-4 py-2.5 rounded-2xl shadow-[4px_4px_0px_#1E293B]">
            <img
              src="/navi-logo.png"
              alt="NAVI"
              className="h-10 w-auto object-contain rounded-lg"
            />
            <div className="flex flex-col">
              <span className="font-['Outfit',sans-serif] text-xl font-black tracking-tight text-[#0F172A]">
                NAVI <span className="text-[#3B82F6]">Operations</span>
              </span>
              <span className="font-['Outfit',sans-serif] text-[11px] font-bold tracking-wider text-[#64748B] uppercase">
                COMMAND CENTER
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border-2 border-[#1E293B] bg-white px-3.5 py-1.5 text-xs font-bold text-[#0F172A] shadow-[3px_3px_0px_#1E293B]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#34A853] border border-[#1E293B]" />
            <span className="text-[#64748B]">SYSTEM:</span>
            <span className="text-[#34A853] font-black">ONLINE</span>
          </div>
        </div>

        {/* Central Hero Notebook Card */}
        <div className="my-auto py-6 max-w-xl">
          <div className="relative devfest-card p-8 bg-white">
            {/* Spiral Notebook Ring Accents along top */}
            <div className="absolute -top-3.5 left-8 right-8 flex justify-between pointer-events-none">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="h-7 w-3.5 rounded-full border-2 border-[#1E293B] bg-[#E2E8F0] shadow-sm" />
              ))}
            </div>

            <div className="mt-2 mb-3 inline-flex items-center gap-2 rounded-full border-2 border-[#1E293B] bg-[#FBBC04] px-3.5 py-1 font-['Outfit',sans-serif] text-xs font-black uppercase text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">
              <span>✨ OPERATIONS SUITE</span>
            </div>

            <h1 className="font-['Outfit',sans-serif] text-5xl xl:text-6xl font-black leading-[1.02] tracking-tight text-[#0F172A]">
              ALL OPERATIONS.<br />
              <span className="text-[#3B82F6] underline decoration-[#FBBC04] decoration-4 underline-offset-4">ONE HUB.</span>
            </h1>

            <div className="mt-4 flex flex-wrap gap-2 text-xs font-extrabold text-[#0F172A]">
              <span className="rounded-xl border-2 border-[#1E293B] bg-[#EA4335] px-2.5 py-1 text-white shadow-[2px_2px_0px_#1E293B]">STORES</span>
              <span className="rounded-xl border-2 border-[#1E293B] bg-[#34A853] px-2.5 py-1 text-white shadow-[2px_2px_0px_#1E293B]">SERVICE CENTRE</span>
              <span className="rounded-xl border-2 border-[#1E293B] bg-[#FBBC04] px-2.5 py-1 text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">DISTRIBUTION</span>
            </div>

            <p className="mt-4 text-sm font-medium leading-relaxed text-[#475569]">
              Direct operational control for inventory ledgering, automated approval routing, precision material assignment, and real-time site telemetry.
            </p>

            {/* DevFest Sticker Multi-Site Blueprint */}
            <div className="mt-6 rounded-2xl border-2 border-[#1E293B] bg-[#F8FAFC] p-4 shadow-[2px_2px_0px_#1E293B]">
              <div className="mb-2 flex items-center justify-between font-['Outfit',sans-serif] text-xs font-bold text-[#64748B]">
                <span className="uppercase">// MULTI-SITE TOPOLOGY SCHEMATIC</span>
                <span className="rounded-md border border-[#1E293B] bg-[#34A853]/20 text-[#166534] px-2 py-0.5 text-[10px] font-black">ISOLATED RLS CELLS</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border-2 border-[#1E293B] bg-white p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <p className="font-['Outfit',sans-serif] text-xs font-black text-[#0F172A]">Central Stores</p>
                  <p className="text-[10px] text-[#64748B] font-bold">Stock & Ledger</p>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-[#FBBC04] p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <p className="font-['Outfit',sans-serif] text-xs font-black text-[#0F172A]">OpsHub Engine</p>
                  <p className="text-[10px] text-[#0F172A] font-bold">Runtime Kernel</p>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-white p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <p className="font-['Outfit',sans-serif] text-xs font-black text-[#0F172A]">Distribution</p>
                  <p className="text-[10px] text-[#64748B] font-bold">Dispatch Hub</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Annotation Footer */}
        <div className="flex items-center justify-between rounded-xl border-2 border-[#1E293B] bg-white px-4 py-2 font-['Outfit',sans-serif] text-xs font-bold text-[#475569] shadow-[3px_3px_0px_#1E293B]">
          <div className="flex items-center gap-3">
            <span>ISOLATION: STRICT RLS</span>
            <span>·</span>
            <span>ENCRYPTION: AES-256</span>
            <span>·</span>
            <span>TELEMETRY: ACTIVE</span>
          </div>
          <span className="text-[#3B82F6] font-black">AUTH_VERSION: 2.5.0</span>
        </div>
      </div>

      {/* Authentication Form Panel (46% on desktop) */}
      <div className="relative z-10 flex lg:col-span-5 flex-col justify-center items-center p-6 sm:p-12 lg:p-14">
        <div className="relative z-10 w-full max-w-[420px]">
          {/* Mobile brand mark */}
          <div className="mb-6 lg:hidden text-center">
            <div className="inline-block p-2 rounded-2xl bg-white border-2 border-[#1E293B] shadow-[4px_4px_0px_#1E293B] mb-2">
              <img
                src="/navi-logo.png"
                alt="NAVI"
                className="mx-auto h-12 w-auto object-contain rounded-lg"
              />
            </div>
            <h1 className="font-['Outfit',sans-serif] text-2xl font-black text-white drop-shadow-[2px_2px_0px_#1E293B]">
              NAVI Operations
            </h1>
            <p className="font-['Outfit',sans-serif] text-xs font-bold text-white/90">
              Stores / Service / Distribution
            </p>
          </div>

          {/* Login Card Notebook Form */}
          <div className="devfest-card p-6 sm:p-8 bg-white relative">
            {/* Form Header */}
            <div className="mb-6">
              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border-2 border-[#1E293B] bg-[#34A853] px-3 py-0.5 text-[10px] font-black uppercase text-white shadow-[2px_2px_0px_#1E293B]">
                <span>●</span> OPERATOR ACCESS
              </div>
              <h2 id="login-title" aria-label="Sign in to OpsHub" className="font-['Outfit',sans-serif] text-3xl font-black tracking-tight text-[#0F172A]">
                Sign in to <span className="text-[#3B82F6]">NAVI</span>
              </h2>
              <p className="mt-1 text-xs font-medium text-[#64748B]">
                Enter authorized credentials to access unit workspaces.
              </p>
            </div>

            <form
              onSubmit={onSubmit}
              noValidate
              aria-labelledby="login-title"
              className="space-y-4"
            >
              {serverError && (
                <div role="alert" className="rounded-xl border-2 border-[#1E293B] bg-[#EA4335] p-3 text-xs font-bold text-white shadow-[3px_3px_0px_#1E293B]">
                  {serverError}
                </div>
              )}

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
                    className="p-1 text-[#64748B] hover:text-[#0F172A] transition"
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
                className="w-full mt-2 h-12 text-sm font-black uppercase tracking-wider rounded-xl devfest-btn"
              >
                <span>Sign in</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Button>

              {import.meta.env.DEV && (
                <div className="mt-4 border-t-2 border-[#1E293B] pt-3 text-center">
                  <p className="font-['Outfit',sans-serif] text-[11px] font-bold text-[#64748B] mb-2">
                    Quick Roles (Demo):
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setValue("email", "admin@opshub.local");
                        setValue("password", "opshub-dev-1");
                      }}
                      className="rounded-full border-2 border-[#1E293B] bg-[#FBBC04] px-2.5 py-1 text-[11px] font-black text-[#0F172A] shadow-[1px_1px_0px_#1E293B] hover:bg-[#F59E0B] transition"
                    >
                      Platform Admin
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setValue("email", "storekeeper@opshub.local");
                        setValue("password", "opshub-dev-1");
                      }}
                      className="rounded-full border-2 border-[#1E293B] bg-[#4285F4] px-2.5 py-1 text-[11px] font-black text-white shadow-[1px_1px_0px_#1E293B] hover:bg-blue-600 transition"
                    >
                      Storekeeper
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setValue("email", "technician@opshub.local");
                        setValue("password", "opshub-dev-1");
                      }}
                      className="rounded-full border-2 border-[#1E293B] bg-[#34A853] px-2.5 py-1 text-[11px] font-black text-white shadow-[1px_1px_0px_#1E293B] hover:bg-green-600 transition"
                    >
                      Technician
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Discreet Help Info */}
          <div className="mt-4 flex items-center justify-between text-xs font-bold text-white drop-shadow-[1px_1px_0px_#1E293B]">
            <span>Need access clearance?</span>
            <span className="underline decoration-2 hover:text-[#FBBC04] cursor-pointer transition">Contact Site Administrator</span>
          </div>
        </div>
      </div>
    </main>
  );
}
