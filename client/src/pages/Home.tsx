import { useAuth } from "@/hooks/useAuth";
import AdminLayout from "@/components/AdminLayout";
import Dashboard from "./Dashboard";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return null; // Will be handled by App.tsx routing
  }

  return (
    <AdminLayout>
      <Dashboard />
    </AdminLayout>
  );
}
