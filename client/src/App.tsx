import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminLayout from "@/components/AdminLayout";

// Pages
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import PendingRequests from "@/pages/PendingRequests";
import AdminManagement from "@/pages/AdminManagement";
import CreateAdmin from "@/pages/CreateAdmin";
import AdminProfile from "@/pages/AdminProfile";
import ChangeRole from "@/pages/ChangeRole";
import DeleteAdmin from "@/pages/DeleteAdmin";
import FinanceManagement from "@/pages/FinanceManagement";
import VerifierManagement from "@/pages/VerifierManagement";
import ApplicationDetail from "@/pages/ApplicationDetail";
import SupportManagement from "@/pages/SupportManagement";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

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

  return (
    <Switch>
      {!isAuthenticated ? (
        <Route path="/" component={Login} />
      ) : (
        <>
          {/* Dashboard */}
          <Route path="/">
            <ProtectedRoute allowedRoles={['super_admin', 'admin_finance', 'admin_verifier', 'admin_support']}>
              <AdminLayout>
                <Dashboard />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          {/* Super Admin Only Routes */}
          <Route path="/pending-requests">
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminLayout>
                <PendingRequests />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management">
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminLayout>
                <AdminManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/create">
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminLayout>
                <CreateAdmin />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/profile/:id">
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminLayout>
                <AdminProfile />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/change-role/:id?">
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminLayout>
                <ChangeRole />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/admin-management/delete/:id?">
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminLayout>
                <DeleteAdmin />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          {/* Role-Based Management Routes */}
          <Route path="/finance-management">
            <ProtectedRoute allowedRoles={['super_admin', 'admin_finance']}>
              <AdminLayout>
                <FinanceManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/verifier-management">
            <ProtectedRoute allowedRoles={['super_admin', 'admin_verifier']}>
              <AdminLayout>
                <VerifierManagement />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/verifier-management/application/:id">
            <ProtectedRoute allowedRoles={['super_admin', 'admin_verifier']}>
              <AdminLayout>
                <ApplicationDetail />
              </AdminLayout>
            </ProtectedRoute>
          </Route>

          <Route path="/support-management">
            <ProtectedRoute allowedRoles={['super_admin', 'admin_support']}>
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

function App() {
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
