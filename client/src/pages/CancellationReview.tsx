import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { tokenManager } from "@/lib/queryClient";

type Tab = "admin_review" | "completed" | "failed";

async function fetchList(status: Tab) {
  const token = tokenManager.getToken();
  const res = await fetch(
    `/api/localguide/admin/cancellation-requests?status=${encodeURIComponent(status)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  return JSON.parse(text) as { requests: Array<Record<string, unknown>> };
}

export default function CancellationReview() {
  const [tab, setTab] = React.useState<Tab>("admin_review");

  const query = useQuery({
    queryKey: ["localguide-cancellation-requests", tab],
    queryFn: () => fetchList(tab),
  });

  const rows = query.data?.requests ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-light text-foreground mb-2">Cancellation review</h1>
        <p className="text-muted-foreground">
          Manual deposit refund requests from LocalGuide travelers. Approve or reject from the detail
          view. Configure server env{" "}
          <code className="text-xs bg-muted px-1 rounded">LOCALGUIDE_*</code> for the proxy.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="w-full"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="admin_review">Pending</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="failed">Failed</TabsTrigger>
            </TabsList>
            <TabsContent value={tab}>
              {query.isLoading && (
                <p className="text-muted-foreground text-sm">Loading…</p>
              )}
              {query.error && (
                <p className="text-destructive text-sm">
                  {(query.error as Error).message}
                </p>
              )}
              {!query.isLoading && !query.error && rows.length === 0 && (
                <p className="text-muted-foreground text-sm">No rows.</p>
              )}
              {rows.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Booking</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Latest effect</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const id = r.id as number;
                      const bookingId = r.bookingId as number;
                      const sum = r.latestEffectSummary as
                        | { effectType?: string; status?: string }
                        | null;
                      return (
                        <TableRow key={id}>
                          <TableCell>{id}</TableCell>
                          <TableCell>{bookingId}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{String(r.status)}</Badge>
                          </TableCell>
                          <TableCell>{String(r.refundTierSnapshot ?? "")}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.submittedAt ? String(r.submittedAt) : "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {sum
                              ? `${sum.effectType ?? ""} / ${sum.status ?? ""}`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Link href={`/cancellation-review/${id}`}>
                              <span className="text-primary text-sm cursor-pointer hover:underline">
                                Open
                              </span>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
