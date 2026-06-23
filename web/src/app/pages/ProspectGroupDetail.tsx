import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  Eye,
  Plus,
  Briefcase,
  DollarSign,
  Flag,
  Layers,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { formatMoney } from "../lib/format";
import { type ApiOpportunity } from "../lib/opportunity";
import { useCanCreateRecords } from "../lib/roles";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent } from "../components/ui/Card";
import { StatCard, LoadingDisplay } from "../components/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/Table";
import { cn } from "../components/ui/utils";

type ProspectGroup = {
  name: string;
  description: string;
  deliverableCount: number;
  totalValue: number;
  currency: string;
  dealStage: string;
  winOrLoss: string;
  lastUpdated: string;
};

function winLossBadgeVariant(winOrLoss: string): "success" | "danger" | "default" {
  if (winOrLoss === "Win") return "success";
  if (winOrLoss === "Loss") return "danger";
  return "default";
}

function statusBadgeVariant(status: string): "default" | "info" | "success" {
  if (status === "In Progress") return "info";
  if (status === "Completed") return "success";
  return "default";
}

export function ProspectGroupDetail() {
  const { prospect: prospectParam } = useParams();
  const prospectName = decodeURIComponent(prospectParam || "");
  const canCreate = useCanCreateRecords();

  const [summary, setSummary] = useState<ProspectGroup | null>(null);
  const [records, setRecords] = useState<ApiOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!prospectName) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      apiFetch<{ items: ProspectGroup[] }>(
        `/prospect-groups?q=${encodeURIComponent(prospectName)}`
      ),
      apiFetch<{ items: ApiOpportunity[] }>(
        `/prospect-groups/${encodeURIComponent(prospectName)}/records`
      ),
    ])
      .then(([groupsRes, recordsRes]) => {
        if (cancelled) return;
        const match =
          groupsRes.items.find((item) => item.name === prospectName) ||
          groupsRes.items[0] ||
          null;
        setSummary(match);
        setRecords(recordsRes.items || []);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load prospect");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prospectName]);

  const deliverableCount = summary?.deliverableCount ?? records.length;
  const totalValue = summary?.totalValue ?? records.reduce((s, r) => s + Number(r.value || 0), 0);
  const currency = summary?.currency || records[0]?.currency || "USD";
  const dealStage = summary?.dealStage || records[0]?.dealStage || "Discovery";
  const winOrLoss = summary?.winOrLoss || "Open";

  const newRecordHref = useMemo(
    () => `/app/opportunities/new?prospect=${encodeURIComponent(prospectName)}`,
    [prospectName]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] p-6">
        <LoadingDisplay message="Loading prospect…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-4 p-6">
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      <Breadcrumbs
        items={[
          { label: "Opportunities", href: "/app/prospect-groups" },
          { label: prospectName },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{prospectName}</h1>
        {canCreate ? (
          <Link to={newRecordHref}>
            <Button type="button">
              <Plus className="h-4 w-4" />
              New Record
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Deliverables"
          value={deliverableCount}
          icon={Layers}
          iconClassName="text-blue-600"
          accentClassName="bg-blue-500"
        />
        <StatCard
          label="Total Value"
          value={formatMoney(Number(totalValue || 0), currency)}
          icon={DollarSign}
          iconClassName="text-emerald-600"
          accentClassName="bg-emerald-500"
        />
        <StatCard
          label="Deal Stage"
          value={dealStage}
          icon={Flag}
          iconClassName="text-violet-600"
          accentClassName="bg-violet-500"
        />
        <Card className="group relative overflow-hidden hover:shadow-md">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Status
                </p>
                <div className="mt-2">
                  <Badge variant={winLossBadgeVariant(winOrLoss)}>{winOrLoss}</Badge>
                </div>
              </div>
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/70 transition-transform group-hover:scale-105"
                )}
              >
                <Briefcase className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Deliverable Type</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Win/Loss</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const deliverablesText = Array.isArray(record.deliverables)
              ? record.deliverables.join(", ")
              : String(record.deliverables || "");
            return (
              <TableRow key={record.id}>
                <TableCell>{record.opportunityDescription}</TableCell>
                <TableCell>{deliverablesText || "—"}</TableCell>
                <TableCell>{record.dueDate || "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(record.status)}>
                    {record.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={winLossBadgeVariant(record.winOrLoss)}>
                    {record.winOrLoss}
                  </Badge>
                </TableCell>
                <TableCell>
                  {formatMoney(Number(record.value || 0), record.currency)}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/app/opportunities/${record.id}`}
                    className="inline-flex text-primary hover:text-primary/80"
                    aria-label="View record"
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
