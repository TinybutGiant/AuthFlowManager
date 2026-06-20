import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TraineeWorkspace() {
  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-trainee-workspace-title">
          Trainee Workspace
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your trainee access is active.</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-muted-foreground">
          <p>Training and activity features are not available yet.</p>
          <p>Please contact your supervisor if you need anything.</p>
        </CardContent>
      </Card>
    </div>
  );
}
