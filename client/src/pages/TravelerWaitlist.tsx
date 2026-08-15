import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";

type WaitlistStatus = "all" | "pending" | "confirmed" | "unsubscribed";

type WaitlistSignup = {
  id: string;
  emailOriginal: string;
  name: string;
  audience: string;
  source: string;
  status: Exclude<WaitlistStatus, "all">;
  locale?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  consentVersion: string;
  createdAt: string;
  confirmationSentAt?: string | null;
  confirmedAt?: string | null;
  unsubscribedAt?: string | null;
};

type WaitlistListResponse = {
  rows: WaitlistSignup[];
  total: number;
  page: number;
  pageSize: number;
};

type WaitlistStats = {
  total: number;
  pending: number;
  confirmed: number;
  unsubscribed: number;
  confirmationRate: number;
};

const PAGE_SIZE = 25;

export default function TravelerWaitlist() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<WaitlistStatus>("all");
  const [page, setPage] = useState(1);

  const listUrl = useMemo(
    () => buildWaitlistUrl("/api/admin/waitlist", { search, status, page }),
    [search, status, page]
  );
  const exportUrl = useMemo(
    () => buildWaitlistUrl("/api/admin/waitlist/export.csv", { search, status }),
    [search, status]
  );

  const { data: stats } = useQuery<WaitlistStats>({
    queryKey: ["/api/admin/waitlist/stats"],
  });

  const { data, isLoading } = useQuery<WaitlistListResponse>({
    queryKey: [listUrl],
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updateStatus = (value: WaitlistStatus) => {
    setStatus(value);
    setPage(1);
  };

  const exportCsv = async () => {
    const response = await apiRequest("GET", exportUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "traveler-waitlist.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-light text-foreground">
          Traveler Waitlist
        </h1>
        <p className="text-muted-foreground">
          Manage traveler waitlist signups from the main Yaotu database.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard title="Total" value={stats?.total ?? 0} />
        <MetricCard title="Pending" value={stats?.pending ?? 0} />
        <MetricCard title="Confirmed" value={stats?.confirmed ?? 0} />
        <MetricCard title="Unsubscribed" value={stats?.unsubscribed ?? 0} />
        <MetricCard
          title="Confirmation Rate"
          value={`${Math.round((stats?.confirmationRate ?? 0) * 100)}%`}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>Signups</CardTitle>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => updateSearch(event.target.value)}
                  placeholder="Search name or email"
                  className="w-full pl-9 sm:w-72"
                />
              </div>
              <Select
                value={status}
                onValueChange={(value) => updateStatus(value as WaitlistStatus)}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>UTM</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Confirmed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Loading waitlist...
                  </TableCell>
                </TableRow>
              ) : (data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No waitlist signups found.
                  </TableCell>
                </TableRow>
              ) : (
                data!.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.emailOriginal}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell>
                      <div>{row.source}</div>
                      <div className="text-xs text-muted-foreground">{row.locale || "-"}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[row.utmSource, row.utmMedium, row.utmCampaign]
                        .filter(Boolean)
                        .join(" / ") || "-"}
                    </TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{formatDate(row.confirmedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data?.total ?? 0} total signups
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function statusBadge(status: WaitlistSignup["status"]) {
  const className =
    status === "confirmed"
      ? "bg-green-500/10 text-green-700"
      : status === "unsubscribed"
        ? "bg-gray-500/10 text-gray-700"
        : "bg-yellow-500/10 text-yellow-700";

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {status}
    </span>
  );
}

function buildWaitlistUrl(
  base: string,
  params: { search?: string; status?: WaitlistStatus; page?: number }
) {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.page) query.set("page", String(params.page));
  query.set("pageSize", String(PAGE_SIZE));
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}
