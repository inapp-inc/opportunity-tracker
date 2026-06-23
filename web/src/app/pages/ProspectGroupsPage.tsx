import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Building2,
  Briefcase,
  CheckCircle2,
  DollarSign,
  Search,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { formatMoney } from "../lib/format";
import { PageHeader, StatCard, LoadingDisplay } from "../components/shared";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/Table";

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

function truncate(text: string, max = 80) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function winLossBadgeVariant(winOrLoss: string): "success" | "danger" | "default" {
  if (winOrLoss === "Win") return "success";
  if (winOrLoss === "Loss") return "danger";
  return "default";
}

function mostCommonCurrency(items: ProspectGroup[]) {
  if (!items.length) return "USD";
  const counts = new Map<string, number>();
  for (const item of items) {
    const code = item.currency || "USD";
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  let best = "USD";
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

export function ProspectGroupsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ProspectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void apiFetch<{ items: ProspectGroup[] }>("/prospect-groups")
      .then((res) => {
        if (!cancelled) {
          setItems(res.items || []);
          setLoadError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load opportunities");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, searchQuery]);

  const pipelineValue = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.totalValue || 0), 0),
    [items]
  );
  const pipelineCurrency = useMemo(() => mostCommonCurrency(items), [items]);
  const wonCount = useMemo(
    () => items.filter((item) => item.winOrLoss === "Win").length,
    [items]
  );
  const openCount = useMemo(
    () => items.filter((item) => item.winOrLoss === "Open").length,
    [items]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] p-6">
        <LoadingDisplay message="Loading opportunities…" />
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
      <PageHeader
        title="Opportunities"
        description="All prospects and their engagement records"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Prospects"
          value={items.length}
          icon={Building2}
          iconClassName="text-blue-600"
          accentClassName="bg-blue-500"
        />
        <StatCard
          label="Pipeline Value"
          value={formatMoney(pipelineValue, pipelineCurrency)}
          icon={DollarSign}
          iconClassName="text-emerald-600"
          accentClassName="bg-emerald-500"
        />
        <StatCard
          label="Won"
          value={wonCount}
          icon={CheckCircle2}
          iconClassName="text-emerald-600"
          accentClassName="bg-emerald-500"
        />
        <StatCard
          label="Open"
          value={openCount}
          icon={Briefcase}
          iconClassName="text-violet-600"
          accentClassName="bg-violet-500"
        />
      </div>

      <div className="relative min-w-[220px] max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search prospects…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-border bg-input-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No opportunities found"
          description="Records will appear here automatically as you create them"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prospect</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Deliverables</TableHead>
              <TableHead>Total Value</TableHead>
              <TableHead>Deal Stage</TableHead>
              <TableHead>Win/Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((row) => (
              <TableRow
                key={row.name}
                className="cursor-pointer"
                onClick={() =>
                  navigate(`/app/prospect-groups/${encodeURIComponent(row.name)}`)
                }
              >
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="max-w-xs text-muted-foreground">
                  {truncate(row.description)}
                </TableCell>
                <TableCell>{row.deliverableCount}</TableCell>
                <TableCell>
                  {formatMoney(Number(row.totalValue || 0), row.currency)}
                </TableCell>
                <TableCell>
                  <Badge variant="info">{row.dealStage}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={winLossBadgeVariant(row.winOrLoss)}>
                    {row.winOrLoss}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
