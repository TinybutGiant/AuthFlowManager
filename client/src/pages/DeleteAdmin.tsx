import { Card, CardContent } from "@/components/ui/card";

export default function DeleteAdmin() {
  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-delete-admin-title">
          Delete Admin
        </h1>
        <p className="text-muted-foreground">
          Remove administrator from the system.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground" data-testid="text-delete-admin-placeholder">
            Admin deletion functionality will be implemented here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
