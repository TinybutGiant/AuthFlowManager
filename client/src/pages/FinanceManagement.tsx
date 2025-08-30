import { Card, CardContent } from "@/components/ui/card";

export default function FinanceManagement() {
  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-finance-management-title">
          Finance Management
        </h1>
        <p className="text-muted-foreground">
          Manage financial operations and reports.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground" data-testid="text-finance-management-placeholder">
            Finance management functionality will be implemented here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
