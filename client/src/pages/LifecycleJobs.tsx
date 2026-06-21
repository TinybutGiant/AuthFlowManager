import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type LifecycleTransitionResult = {
  activated_count: number;
  offboarded_count: number;
  errors?: Array<{ engagementId?: number; phase?: string; message?: string }>;
};

export default function LifecycleJobs() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const lifecycleTransitionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/engagements/run-lifecycle-transitions");
      return response.json() as Promise<LifecycleTransitionResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Lifecycle transitions run",
        description: `Activated ${result.activated_count}, offboarded ${result.offboarded_count}.`,
        variant: result.errors && result.errors.length > 0 ? "warning" : "default",
      });
    },
    onError: (error) => {
      toast({
        title: "Lifecycle transition failed",
        description: getApiErrorMessage(error, "Could not run lifecycle transitions."),
        variant: "destructive",
      });
    },
  });

  const result = lifecycleTransitionMutation.data;
  const errors = result?.errors ?? [];

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-lifecycle-jobs-title">
          Lifecycle Jobs
        </h1>
        <p className="text-muted-foreground">
          Run global admin lifecycle jobs for due trainee engagements.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Trainee Lifecycle Transitions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Checks all due trainee engagements, not only one user. Due starts are activated, and expired engagements are offboarded.
          </p>

          <Button
            onClick={() => lifecycleTransitionMutation.mutate()}
            disabled={lifecycleTransitionMutation.isPending}
            data-testid="button-run-lifecycle-transitions"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {lifecycleTransitionMutation.isPending ? "Running..." : "Run all due lifecycle transitions"}
          </Button>

          {result && (
            <div className="flex flex-wrap gap-3" data-testid="lifecycle-job-result">
              <Badge variant="outline">Activated {result.activated_count}</Badge>
              <Badge variant="outline">Offboarded {result.offboarded_count}</Badge>
              <Badge variant={errors.length > 0 ? "destructive" : "secondary"}>Errors {errors.length}</Badge>
            </div>
          )}

          {errors.length > 0 && (
            <div className="space-y-2" data-testid="lifecycle-job-errors">
              {errors.map((error, index) => (
                <div key={`${error.engagementId ?? "unknown"}-${index}`} className="rounded-md border border-destructive/40 p-3 text-sm">
                  <p className="font-medium">Engagement {error.engagementId ?? "unknown"}</p>
                  <p className="text-muted-foreground">{error.phase ?? "transition"}: {error.message ?? "Unknown error"}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
