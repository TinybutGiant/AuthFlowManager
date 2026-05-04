import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, tokenManager } from "@/lib/queryClient";

type DetailResponse = {
  request: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  booking: Record<string, unknown> | null;
  depositSummary: {
    paymentId: number;
    billId: number;
    allocatedAmountCents: number;
    currency: string;
    paymentStatus: string;
  } | null;
};

async function fetchDetail(id: string): Promise<DetailResponse> {
  const token = tokenManager.getToken();
  const res = await fetch(`/api/localguide/admin/cancellation-requests/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return JSON.parse(text) as DetailResponse;
}

export default function CancellationReviewDetail() {
  const [, params] = useRoute("/cancellation-review/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [amountCents, setAmountCents] = React.useState("");
  const [percentBps, setPercentBps] = React.useState("");
  const [approveNotes, setApproveNotes] = React.useState("");
  const [rejectNotes, setRejectNotes] = React.useState("");
  const [rejectReasonCode, setRejectReasonCode] = React.useState("");

  const detailQuery = useQuery({
    queryKey: ["localguide-cancellation-request", id],
    queryFn: () => fetchDetail(id),
    enabled: Boolean(id),
  });

  const request = detailQuery.data?.request;
  const status = request?.status as string | undefined;
  const canAct = status === "admin_review";

  const openApproveDialog = () => {
    const r = detailQuery.data?.request;
    const dep = detailQuery.data?.depositSummary;
    const suggested =
      (typeof r?.refundAmountCents === "number" && r.refundAmountCents > 0
        ? r.refundAmountCents
        : null) ??
      dep?.allocatedAmountCents ??
      "";
    setAmountCents(suggested === "" ? "" : String(suggested));
    setPercentBps("");
    setApproveNotes("");
    setApproveOpen(true);
  };

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: ["localguide-cancellation-requests"] });
    queryClient.invalidateQueries({ queryKey: ["localguide-cancellation-request", id] });
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      const cents = parseInt(amountCents, 10);
      if (!Number.isFinite(cents) || cents <= 0) {
        throw new Error("Enter a positive refund amount in cents.");
      }
      const body: Record<string, unknown> = {
        amountCents: cents,
        adminNotes: approveNotes.trim() || undefined,
      };
      const bps = percentBps.trim() ? parseInt(percentBps, 10) : NaN;
      if (Number.isFinite(bps)) body.percentBps = bps;
      const res = await apiRequest(
        "POST",
        `/api/localguide/admin/cancellation-requests/${encodeURIComponent(id)}/approve-refund`,
        body
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Refund approved", description: "LocalGuide processed the deposit refund." });
      setApproveOpen(false);
      invalidateList();
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Approve failed", description: e.message });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const notes = rejectNotes.trim();
      if (!notes) throw new Error("Reason is required.");
      const body: Record<string, unknown> = {
        adminNotes: notes,
        reasonCode: rejectReasonCode.trim() || undefined,
      };
      const res = await apiRequest(
        "POST",
        `/api/localguide/admin/cancellation-requests/${encodeURIComponent(id)}/reject-refund`,
        body
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Request rejected", description: "No traveler refund was created." });
      setRejectOpen(false);
      setRejectNotes("");
      setRejectReasonCode("");
      invalidateList();
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Reject failed", description: e.message });
    },
  });

  if (!id) {
    return <p className="text-muted-foreground text-sm">Missing id.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/cancellation-review">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-light text-foreground mb-1">Cancellation request #{id}</h1>
        <p className="text-muted-foreground text-sm">
          Deposit-only refunds. Final/extension charges are not refunded here.
        </p>
      </div>

      {detailQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {detailQuery.error && (
        <p className="text-destructive text-sm">{(detailQuery.error as Error).message}</p>
      )}

      {request && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{String(request.status)}</Badge>
          <Badge variant="outline">{String(request.intent)}</Badge>
          {request.refundTierSnapshot ? (
            <Badge variant="outline">Tier: {String(request.refundTierSnapshot)}</Badge>
          ) : null}
        </div>
      )}

      {detailQuery.data && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!canAct} onClick={openApproveDialog}>
              Approve deposit refund
            </Button>
            <Button variant="outline" disabled={!canAct} onClick={() => setRejectOpen(true)}>
              Reject (no refund)
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Booking</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {detailQuery.data.booking ? (
                  <>
                    <div>Status: {String(detailQuery.data.booking.status)}</div>
                    <div>Booking id: {String(detailQuery.data.booking.id)}</div>
                    <div>Traveler: {String(detailQuery.data.booking.travelerId)}</div>
                    <div>Guide: {String(detailQuery.data.booking.guideId)}</div>
                    <div>Start: {String(detailQuery.data.booking.scheduledStartTime ?? "—")}</div>
                  </>
                ) : (
                  <p className="text-muted-foreground">No booking row.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Deposit (Stripe)</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {detailQuery.data.depositSummary ? (
                  <>
                    <div>Allocated (cents): {detailQuery.data.depositSummary.allocatedAmountCents}</div>
                    <div>Currency: {detailQuery.data.depositSummary.currency}</div>
                    <div>Payment status: {detailQuery.data.depositSummary.paymentStatus}</div>
                    <div>Payment id: {detailQuery.data.depositSummary.paymentId}</div>
                  </>
                ) : (
                  <p className="text-muted-foreground">No succeeded deposit payment found.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Policy snapshot (at submit)</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>policySetId: {String(request?.policySetId ?? "—")}</div>
              <div>policySetVersion: {String(request?.policySetVersion ?? "—")}</div>
              <div>ruleId: {String(request?.ruleId ?? "—")}</div>
              <div>rulePriority: {String(request?.rulePriority ?? "—")}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div>Reason: {request?.reason ? String(request.reason) : "—"}</div>
              <div>Notes: {request?.notes ? String(request.notes) : "—"}</div>
              <div>
                <span className="text-muted-foreground">bookingSnapshot</span>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                  {JSON.stringify(request?.bookingSnapshot ?? null, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Effects timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Result / ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailQuery.data.effects.map((e) => (
                    <TableRow key={String(e.id)}>
                      <TableCell>{String(e.effectType)}</TableCell>
                      <TableCell>{String(e.status)}</TableCell>
                      <TableCell>{e.amountCents != null ? String(e.amountCents) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {e.createdAt ? String(e.createdAt) : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs">
                        {e.providerRef != null ? String(e.providerRef) : ""}
                        {e.executionResult != null
                          ? JSON.stringify(e.executionResult).slice(0, 120)
                          : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve deposit refund</DialogTitle>
            <DialogDescription>
              Only the traveler deposit is refunded via Stripe. Do not exceed the deposit allocation
              shown on the detail page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="amount-cents">Amount (cents)</Label>
              <Input
                id="amount-cents"
                inputMode="numeric"
                value={amountCents}
                onChange={(ev) => setAmountCents(ev.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="percent-bps">Percent (bps, optional)</Label>
              <Input
                id="percent-bps"
                inputMode="numeric"
                value={percentBps}
                onChange={(ev) => setPercentBps(ev.target.value)}
                placeholder="e.g. 5000 for 50%"
              />
            </div>
            <div>
              <Label htmlFor="approve-notes">Admin notes (optional)</Label>
              <Textarea
                id="approve-notes"
                value={approveNotes}
                onChange={(ev) => setApproveNotes(ev.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
              {approveMutation.isPending ? "Submitting…" : "Confirm refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject refund request</DialogTitle>
            <DialogDescription>
              Marks the review complete with no traveler_refund effect. This is a business decision,
              not a system failure.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="reject-notes">Reason (required)</Label>
              <Textarea
                id="reject-notes"
                value={rejectNotes}
                onChange={(ev) => setRejectNotes(ev.target.value)}
                rows={4}
                required
              />
            </div>
            <div>
              <Label htmlFor="reason-code">Reason code (optional)</Label>
              <Input
                id="reason-code"
                value={rejectReasonCode}
                onChange={(ev) => setRejectReasonCode(ev.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>
              {rejectMutation.isPending ? "Submitting…" : "Confirm reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
