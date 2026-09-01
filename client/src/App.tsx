import * as React from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient as legacyQueryClient } from "./lib/queryClient";
import { v2QueryClient } from "./lib/v2QueryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminLayout from "@/components/AdminLayout";
import type { AdminAccessGroup } from "@/types/admin";

// Pages
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import Dashboard from "@/pages/Dashboard";
import PendingRequests from "@/pages/PendingRequests";
import AdminManagement from "@/pages/AdminManagement";
import CreateAdmin from "@/pages/CreateAdmin";
import AdminProfile from "@/pages/AdminProfile";
import PersonnelManagement from "@/pages/PersonnelManagement";
import OfferLetterBuilderPage from "@/pages/OfferLetterBuilderPage";
import ChangeRole from "@/pages/ChangeRole";
import DeleteAdmin from "@/pages/DeleteAdmin";
import FinanceManagement from "@/pages/FinanceManagement";
import VerifierManagement from "@/pages/VerifierManagement";
import ApplicationDetail from "@/pages/ApplicationDetail";
import SupportManagement from "@/pages/SupportManagement";
import CancellationReview from "@/pages/CancellationReview";
import CancellationReviewDetail from "@/pages/CancellationReviewDetail";
import TraineeWorkspace from "@/pages/TraineeWorkspace";
import LifecycleJobs from "@/pages/LifecycleJobs";
import DocumentTemplates from "@/pages/DocumentTemplates";
import TravelerWaitlist from "@/pages/TravelerWaitlist";
import FeedbackMeetingSlots from "@/pages/FeedbackMeetingSlots";
import V2FinanceManagement from "@/pages/V2FinanceManagement";
import V2PayrollManagement from "@/pages/V2PayrollManagement";
import V2TaxManagement from "@/pages/V2TaxManagement";
import V2VerifierApplicationDetail from "@/pages/V2VerifierApplicationDetail";
import V2VerifierManagement from "@/pages/V2VerifierManagement";
import V2StaffManagement from "@/pages/V2StaffManagement";
import V2Home from "@/pages/V2Home";
import V2Shell from "@/components/V2Shell";
import NotFound from "@/pages/not-found";

const isV2Surface = import.meta.env.VITE_AUTHFLOW_SURFACE === "v2";

function VerifierApplicationDetailRoute() {
  return (
    <ProtectedRoute allowedRoles={["super_admin", "admin_verifier"]}>
      <AdminLayout>
        <ApplicationDetail />
      </AdminLayout>
    </ProtectedRoute>
  );
}

function WaitlistManagementRoute() {
  return (
    <ProtectedRoute allowedAccessGroups={["super_admin", "admin_operations"]}>
      <AdminLayout>
        <TravelerWaitlist />
      </AdminLayout>
    </ProtectedRoute>
  );
}

function LegacyRouter() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [location, setLocation] = useLocation();
  const adminUser = (user as any)?.adminUser;
  const accessGroups = ((user as any)?.accessGroups ?? adminUser?.accessGroups ?? []) as AdminAccessGroup[];
  const hasTraineeAccess = accessGroups.some((accessGroup) =>
    ["trainee_offer_portal", "trainee_workspace"].includes(accessGroup)
  );

  React.useEffect(() => {
    if (!isLoading && isAuthenticated && location === "/" && hasTraineeAccess) {
      setLocation("/trainee");
    }
  }, [hasTraineeAccess, isAuthenticated, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated && location === "/" && hasTraineeAccess) {
    return null;
  }

  return (
    <Switch>
      <Route path="/set-password" component={SetPassword} />

      {!isAuthenticated ? (
        <Route path="/" component={Login} />
      ) : (
        <>
          {/* Dashboard */}
          <Route path="/trainee">
            <ProtectedRoute allowedAccessGroups={["trainee_offer_portal", "trainee_workspace"]}>
              <AdminLayout>
                <TraineeWorkspace />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/">
            <ProtectedRoute
              allowedRoles={[
                "super_admin",
                "admin_finance",
                "admin_verifier",
                "admin_support",
              ]}
            >
              <AdminLayout>
                <Dashboard />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          {/* Super Admin Only Routes */}
          <Route path="/pending-requests">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <PendingRequests />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <AdminManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/create">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <CreateAdmin />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/personnel">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <PersonnelManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/profile/:id/offer-letter/new">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <OfferLetterBuilderPage />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/profile/:id">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <AdminProfile />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/change-role/:id?">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <ChangeRole />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/delete/:id?">
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminLayout>
                <DeleteAdmin />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-operations/lifecycle-jobs">
            <ProtectedRoute allowedAccessGroups={["super_admin", "lifecycle_jobs"]}>
              <AdminLayout>
                <LifecycleJobs />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-operations/document-templates">
            <ProtectedRoute allowedAccessGroups={["super_admin", "document_templates"]}>
              <AdminLayout>
                <DocumentTemplates />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-operations/feedback-meeting-slots">
            <ProtectedRoute
              allowedRoles={[
                "super_admin",
                "admin_finance",
                "admin_verifier",
                "admin_support",
              ]}
            >
              <AdminLayout>
                <FeedbackMeetingSlots />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          {/* Role-Based Management Routes */}
          <Route path="/verifier-management/application/:id">
            <VerifierApplicationDetailRoute />
          </Route>

          <Route path="/application/:id">
            <VerifierApplicationDetailRoute />
          </Route>

          <Route path="/finance-management/:section">
            <ProtectedRoute allowedRoles={["super_admin", "admin_finance"]}>
              <AdminLayout>
                <FinanceManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/finance-management">
            <ProtectedRoute allowedRoles={["super_admin", "admin_finance"]}>
              <AdminLayout>
                <FinanceManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/cancellation-review/:id">
            <ProtectedRoute allowedRoles={["super_admin", "admin_finance"]}>
              <AdminLayout>
                <CancellationReviewDetail />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/cancellation-review">
            <ProtectedRoute allowedRoles={["super_admin", "admin_finance"]}>
              <AdminLayout>
                <CancellationReview />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/waitlist-management">
            <WaitlistManagementRoute />
          </Route>

          <Route path="/verifier-management">
            <ProtectedRoute allowedRoles={["super_admin", "admin_verifier"]}>
              <AdminLayout>
                <VerifierManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/support-management">
            <ProtectedRoute allowedRoles={["super_admin", "admin_support"]}>
              <AdminLayout>
                <SupportManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>
        </>
      )}

      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const [location, setLocation] = useLocation();

  React.useEffect(() => {
    if (isV2Surface && location === "/") {
      setLocation("/v2");
    }
  }, [location, setLocation]);

  if (!isV2Surface) {
    return <LegacyRouter />;
  }

  if (location === "/" || location === "/v2") {
    return (
      <V2Shell>
        <V2Home />
      </V2Shell>
    );
  }

  if (location === "/v2/finance" || location.startsWith("/v2/finance/")) {
    return (
      <V2Shell>
        <V2FinanceManagement />
      </V2Shell>
    );
  }

  if (location === "/v2/payroll" || location.startsWith("/v2/payroll/")) {
    return (
      <V2Shell>
        <V2PayrollManagement />
      </V2Shell>
    );
  }

  if (location === "/v2/tax" || location.startsWith("/v2/tax/")) {
    return (
      <V2Shell>
        <V2TaxManagement />
      </V2Shell>
    );
  }

  if (location === "/v2/staff" || location.startsWith("/v2/staff/")) {
    return (
      <V2Shell>
        <V2StaffManagement />
      </V2Shell>
    );
  }

  if (location.startsWith("/v2/verifier/applications/")) {
    return (
      <V2Shell>
        <V2VerifierApplicationDetail />
      </V2Shell>
    );
  }

  if (location === "/v2/verifier" || location.startsWith("/v2/verifier/")) {
    return (
      <V2Shell>
        <V2VerifierManagement />
      </V2Shell>
    );
  }

  return (
    <V2Shell>
      <NotFound />
    </V2Shell>
  );
}

function App() {
  const [location] = useLocation();
  const { dismiss } = useToast();
  const queryClient = isV2Surface ? v2QueryClient : legacyQueryClient;

  // Route changes shouldn't carry over toasts from previous pages.
  const didMountRef = React.useRef(false);
  React.useEffect(() => {
    if (didMountRef.current) {
      dismiss();
      return;
    }
    didMountRef.current = true;
  }, [location, dismiss]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
