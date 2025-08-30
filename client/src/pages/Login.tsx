import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export default function Login() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  useEffect(() => {
    // Auto-redirect to login if needed
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auto') === 'true') {
      handleLogin();
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-6">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-full mb-4">
              <Settings className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-medium text-foreground">Admin Panel</h1>
            <p className="text-muted-foreground mt-2">Sign in to manage the platform</p>
          </div>

          <Button 
            onClick={handleLogin} 
            className="w-full" 
            size="lg"
            data-testid="button-login"
          >
            Sign In with Replit
          </Button>

          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground">
              Secure admin access only • Contact IT for account issues
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
