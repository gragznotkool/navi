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
    <main className="grid min-h-full place-items-center p-4">
      <form onSubmit={onSubmit} noValidate aria-labelledby="login-title" className="w-full max-w-sm rounded-ui border border-line bg-surface p-6">
        <h1 id="login-title" className="text-lg font-semibold">Sign in to OpsHub</h1>
        <p className="mb-4 mt-1 text-sm text-muted">Operations platform for your sites.</p>
        {serverError && <p role="alert" className="mb-3 rounded-ui bg-red-50 p-2 text-sm text-danger">{serverError}</p>}
        <div className="flex flex-col gap-3">
          <TextField label="Email" type="email" autoComplete="username" error={formState.errors.email?.message} {...register("email")} />
          <TextField label="Password" type="password" autoComplete="current-password" error={formState.errors.password?.message} {...register("password")} />
          <Button type="submit" variant="primary" loading={formState.isSubmitting}>Sign in</Button>
        </div>
        {import.meta.env.DEV && (
          <p className="mt-4 text-xs text-muted">Local development accounts are listed in docs/demo-runbook.md.</p>
        )}
      </form>
    </main>
  );
}
