import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AdminRole } from "@/types/admin";
import { useToast } from "@/hooks/use-toast";
import { tokenManager } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: AdminRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSwitchAccount = () => {
    tokenManager.removeToken();
    queryClient.clear();
    window.location.href = "/";
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

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

  if (!isAuthenticated) {
    return null;
  }

  const adminUser = (user as any)?.adminUser;
  if (!adminUser || !allowedRoles.includes(adminUser.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-4">You don't have permission to access this page.</p>
          <Button onClick={handleSwitchAccount} variant="outline" data-testid="button-switch-account">
            Switch account
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
