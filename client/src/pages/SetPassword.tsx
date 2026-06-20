import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type TokenState =
  | { status: "loading" }
  | { status: "valid"; email: string; name: string }
  | { status: "invalid"; message: string }
  | { status: "complete" };

export default function SetPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [state, setState] = useState<TokenState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const token = useMemo(() => {
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setState({ status: "invalid", message: "Missing password setup token." });
        return;
      }

      const response = await fetch("/api/auth/password-setup/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        setState({ status: "invalid", message: "This password setup link is invalid or expired." });
        return;
      }

      const data = await response.json();
      setState({ status: "valid", email: data.email, name: data.name });
    }

    validateToken().catch(() => {
      setState({ status: "invalid", message: "Could not validate this password setup link." });
    });
  }, [token]);

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Please re-enter the same password.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        throw new Error("Password setup failed");
      }

      setState({ status: "complete" });
      toast({
        title: "Password set",
        description: "You can now sign in with your new password.",
      });
    } catch {
      toast({
        title: "Setup failed",
        description: "This link may be expired. Ask a super admin to resend setup access.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>Set Admin Password</CardTitle>
        </CardHeader>
        <CardContent>
          {state.status === "loading" && (
            <p className="text-sm text-muted-foreground">Checking setup link...</p>
          )}

          {state.status === "invalid" && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{state.message}</p>
              <Button onClick={() => navigate("/")}>Back to Login</Button>
            </div>
          )}

          {state.status === "complete" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Your password has been set.</p>
              <Button onClick={() => navigate("/")}>Go to Login</Button>
            </div>
          )}

          {state.status === "valid" && (
            <form onSubmit={submitPassword} className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Setting password for <span className="font-medium text-foreground">{state.email}</span>
              </div>

              <div>
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div>
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Setting..." : "Set Password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
