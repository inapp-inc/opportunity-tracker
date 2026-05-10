import { Outlet } from "react-router";

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Outlet />
    </div>
  );
}
