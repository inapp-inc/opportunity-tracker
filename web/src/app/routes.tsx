import { createBrowserRouter } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SignIn } from "./pages/SignIn";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Dashboard } from "./pages/Dashboard";
import { OpportunitiesWorkspace } from "./pages/OpportunitiesWorkspace";
import { OpportunityDetail } from "./pages/OpportunityDetail";
import { OpportunityForm } from "./pages/OpportunityForm";
import { NotificationsCenter } from "./pages/NotificationsCenter";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { ComponentLibrary } from "./pages/ComponentLibrary";
import { NotFound } from "./pages/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AuthLayout />,
    children: [
      { index: true, element: <SignIn /> },
      { path: "forgot-password", element: <ForgotPassword /> },
    ],
  },
  {
    path: "/app",
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
      { index: true, element: <Dashboard /> },
      { path: "opportunities", element: <OpportunitiesWorkspace /> },
      { path: "opportunities/new", element: <OpportunityForm /> },
      { path: "opportunities/:id", element: <OpportunityDetail /> },
      { path: "opportunities/:id/edit", element: <OpportunityForm /> },
      { path: "notifications", element: <NotificationsCenter /> },
      { path: "reports", element: <Reports /> },
      { path: "settings", element: <Settings /> },
      { path: "components", element: <ComponentLibrary /> },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
]);
