import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { usePageAccess, type PageKey } from "../lib/pageAccess";
import { LoadingDisplay, ErrorDisplay } from "./shared";

export function PageAccessGuard({
  page,
  children,
}: {
  page: PageKey;
  children: ReactNode;
}) {
  const { canAccess, loading } = usePageAccess();
  const location = useLocation();

  if (loading) return <LoadingDisplay />;
  if (canAccess(page)) return <>{children}</>;

  // If user is blocked from a direct URL, send them to the dashboard.
  if (location.pathname !== "/app") return <Navigate to="/app" replace />;

  return (
    <ErrorDisplay
      title="Access denied"
      description="You don’t have permission to view this page."
    />
  );
}

