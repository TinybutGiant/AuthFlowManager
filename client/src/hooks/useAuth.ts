import { useQuery } from "@tanstack/react-query";
import { tokenManager } from "@/lib/queryClient";

export function useAuth() {
  const token = tokenManager.getToken();
  
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    enabled: !!token, // Only fetch if we have a token
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !!token,
  };
}
