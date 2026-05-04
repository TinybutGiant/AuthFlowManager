import { Card, CardContent } from "@/components/ui/card";

export default function RefundRequestDetail() {
  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2">
          Refund Request Detail
        </h1>
        <p className="text-muted-foreground">
          View and manage refund request details.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">
            Refund request detail functionality will be implemented here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
