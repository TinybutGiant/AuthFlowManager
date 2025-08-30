import { Card, CardContent } from "@/components/ui/card";

export default function ChangeRole() {
  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-change-role-title">
          Change Role
        </h1>
        <p className="text-muted-foreground">
          Change administrator role and permissions.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground" data-testid="text-change-role-placeholder">
            Role change functionality will be implemented here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
