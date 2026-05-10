import { Link } from "react-router";
import { Button } from "../components/ui/Button";
import { ArrowLeft, Info } from "lucide-react";

export function ForgotPassword() {
  return (
    <div className="w-full max-w-md">
      <div className="bg-card border border-border rounded-lg p-8 shadow-lg">
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign In
          </Link>
          <h1 className="mb-2">Password recovery</h1>
          <p className="text-muted-foreground">
            This build uses a single sign-in defined on the API server. Self‑service
            password reset is not available.
          </p>
        </div>

        <div className="flex gap-3 p-4 rounded-lg border border-border bg-muted/40 text-sm">
          <Info className="w-5 h-5 flex-shrink-0 text-muted-foreground mt-0.5" />
          <div className="space-y-2">
            <p>
              Ask whoever runs the tracker to update{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                STATIC_AUTH_EMAIL
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                STATIC_AUTH_PASSWORD
              </code>{" "}
              on the server, or use the current demo credentials from the sign-in
              screen if your environment still uses the defaults.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Link to="/" className="block">
            <Button variant="outline" className="w-full">
              Back to Sign In
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
