import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PageAccessGuard } from "./components/PageAccessGuard";

const SignIn = lazy(() => import("./pages/SignIn").then((m) => ({ default: m.SignIn })));
const ForgotPassword = lazy(() =>
  import("./pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword }))
);
const AcceptInvite = lazy(() =>
  import("./pages/AcceptInvite").then((m) => ({ default: m.AcceptInvite }))
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard }))
);
const OpportunitiesWorkspace = lazy(() =>
  import("./pages/OpportunitiesWorkspace").then((m) => ({
    default: m.OpportunitiesWorkspace,
  }))
);
const OpportunityDetail = lazy(() =>
  import("./pages/OpportunityDetail").then((m) => ({ default: m.OpportunityDetail }))
);
const OpportunityForm = lazy(() =>
  import("./pages/OpportunityForm").then((m) => ({ default: m.OpportunityForm }))
);
const ProspectGroupsPage = lazy(() =>
  import("./pages/ProspectGroupsPage").then((m) => ({ default: m.ProspectGroupsPage }))
);
const ProspectGroupDetail = lazy(() =>
  import("./pages/ProspectGroupDetail").then((m) => ({ default: m.ProspectGroupDetail }))
);
const NotificationsCenter = lazy(() =>
  import("./pages/NotificationsCenter").then((m) => ({
    default: m.NotificationsCenter,
  }))
);
const Reports = lazy(() =>
  import("./pages/Reports").then((m) => ({ default: m.Reports }))
);
const ArtifactLinks = lazy(() =>
  import("./pages/ArtifactLinks").then((m) => ({ default: m.ArtifactLinks }))
);
const CaseStudies = lazy(() =>
  import("./pages/CaseStudies").then((m) => ({ default: m.CaseStudies }))
);
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings }))
);
const NotFound = lazy(() =>
  import("./pages/NotFound").then((m) => ({ default: m.NotFound }))
);

function PageLoader() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  );
}

function lazyElement(element: ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>;
}

const basename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AuthLayout />,
    children: [
      { index: true, element: lazyElement(<SignIn />) },
      { path: "forgot-password", element: lazyElement(<ForgotPassword />) },
      { path: "accept-invite", element: lazyElement(<AcceptInvite />) },
    ],
  },
  {
    path: "/app",
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          {
            index: true,
            element: lazyElement(
              <PageAccessGuard page="dashboard">
                <Dashboard />
              </PageAccessGuard>
            ),
          },
          {
            path: "opportunities",
            element: lazyElement(
              <PageAccessGuard page="records">
                <OpportunitiesWorkspace />
              </PageAccessGuard>
            ),
          },
          {
            path: "opportunities/new",
            element: lazyElement(
              <PageAccessGuard page="records">
                <OpportunityForm />
              </PageAccessGuard>
            ),
          },
          {
            path: "opportunities/:id",
            element: lazyElement(
              <PageAccessGuard page="records">
                <OpportunityDetail />
              </PageAccessGuard>
            ),
          },
          {
            path: "opportunities/:id/edit",
            element: lazyElement(
              <PageAccessGuard page="records">
                <OpportunityForm />
              </PageAccessGuard>
            ),
          },
          {
            path: "prospect-groups",
            element: lazyElement(
              <PageAccessGuard page="opportunities">
                <ProspectGroupsPage />
              </PageAccessGuard>
            ),
          },
          {
            path: "prospect-groups/:prospect",
            element: lazyElement(
              <PageAccessGuard page="opportunities">
                <ProspectGroupDetail />
              </PageAccessGuard>
            ),
          },
          {
            path: "artifacts",
            element: lazyElement(
              <PageAccessGuard page="artifacts">
                <ArtifactLinks />
              </PageAccessGuard>
            ),
          },
          {
            path: "notifications",
            element: lazyElement(
              <PageAccessGuard page="notifications">
                <NotificationsCenter />
              </PageAccessGuard>
            ),
          },
          {
            path: "case-studies",
            element: lazyElement(
              <PageAccessGuard page="caseStudies">
                <CaseStudies />
              </PageAccessGuard>
            ),
          },
          {
            path: "reports",
            element: lazyElement(
              <PageAccessGuard page="reports">
                <Reports />
              </PageAccessGuard>
            ),
          },
          {
            path: "settings",
            element: lazyElement(
              <PageAccessGuard page="settings">
                <Settings />
              </PageAccessGuard>
            ),
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: lazyElement(<NotFound />),
  },
], { basename });
