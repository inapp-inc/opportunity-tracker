import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router";
import { Button } from "../components/ui/Button";
import { ArrowLeft, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

type Status = "loading" | "ready" | "submitting" | "done" | "error";

export function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    if (!token) {
      setErrorMsg("No invite token found in the URL.");
      setStatus("error");
      return;
    }
    fetch(`/auth/invite/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Invalid invite link.");
        setEmail(data.email);
        setStatus("ready");
      })
      .catch((err) => {
        setErrorMsg(err.message);
        setStatus("error");
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError("");
    if (password.length < 8) {
      setFieldError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFieldError("Passwords do not match.");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Something went wrong.");
      setStatus("done");
      setTimeout(() => navigate("/"), 2500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-card border border-border rounded-lg p-8 shadow-lg">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign In
          </Link>
          <h1 className="mb-1">Set your password</h1>
          {email && (
            <p className="text-sm text-muted-foreground">
              Setting password for <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
        </div>

        {status === "loading" && (
          <div className="flex items-center gap-3 text-muted-foreground text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Validating invite link…
          </div>
        )}

        {status === "error" && (
          <div className="flex gap-3 p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">Invite link invalid</p>
              <p>{errorMsg}</p>
            </div>
          </div>
        )}

        {status === "done" && (
          <div className="flex gap-3 p-4 rounded-lg border border-green-500/40 bg-green-500/10 text-sm text-green-700 dark:text-green-400">
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">Password set!</p>
              <p>Redirecting you to sign in…</p>
            </div>
          </div>
        )}

        {(status === "ready" || status === "submitting") && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="confirm">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Re-enter your password"
                required
              />
            </div>
            {fieldError && (
              <p className="text-sm text-destructive">{fieldError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={status === "submitting"}
            >
              {status === "submitting" ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Setting password…
                </span>
              ) : (
                "Set password & activate account"
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
