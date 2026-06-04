import { Link } from "react-router";
import { Button } from "../components/ui/Button";
import { Home } from "lucide-react";
import { useTerminology } from "../lib/terminology";

export function NotFound() {
  const terminology = useTerminology();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-6xl mb-4">404</h1>
        <h2 className="mb-4">Page Not Found</h2>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link to="/app">
          <Button>
            <Home className="w-4 h-4" />
            Go to {terminology.dashboardLabel || "Dashboard"}
          </Button>
        </Link>
      </div>
    </div>
  );
}
