import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { apiFetch } from "../../../lib/api";
import { emitWorkspaceLayoutUpdated } from "../../../lib/pageLayoutEvents";
import {
  DEFAULT_SUMMARY_CARDS,
  normalizeSummaryCardsConfig,
  type SummaryCardsConfig,
  type SummaryAggregation,
  type SummaryCardFilter,
  type SummaryCardFilterOp,
  type SummaryCardFilterPreset,
} from "../../../lib/summaryCards";
import { buildDashboardFieldOptions, dashboardFieldForType, dashboardOptionsForWidgetType } from "../../../lib/dashboard";
import { useTenantSchema } from "../../../lib/serverState";

const AGG_OPTIONS: { value: SummaryAggregation; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];

const FILTER_PRESET_OPTIONS: { value: SummaryCardFilterPreset; label: string }[] = [
  { value: "all", label: "All records" },
  { value: "completed", label: "Completed only" },
  { value: "overdue", label: "Overdue only" },
];

const FILTER_OP_OPTIONS: { value: SummaryCardFilterOp; label: string }[] = [
  { value: "eq", label: "Equals" },
  { value: "neq", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "in", label: "In list" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater than or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less than or equal" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
];

export function SummaryCardsPanel() {
  const { fields: schemaFields } = useTenantSchema();
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<SummaryCardsConfig>(DEFAULT_SUMMARY_CARDS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ summaryCards?: SummaryCardsConfig }>("/settings");
      setConfig(normalizeSummaryCardsConfig(res.summaryCards));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useMemo(() => normalizeSummaryCardsConfig(config).cards, [config]);

  const fieldOptions = useMemo(() => buildDashboardFieldOptions(schemaFields), [schemaFields]);

  const optionsForAgg = (aggregation: SummaryAggregation) => {
    if (aggregation === "count") return fieldOptions;
    // sum/avg/min/max require numeric fields.
    return dashboardOptionsForWidgetType("metric_sum" as any, fieldOptions);
  };

  const updateCard = (idx: number, patch: Partial<SummaryCardsConfig["cards"][number]>) => {
    setConfig((prev) => {
      const next = normalizeSummaryCardsConfig(prev);
      next.cards[idx] = { ...next.cards[idx], ...patch };
      return next;
    });
  };

  const addCard = () => {
    setConfig((prev) => {
      const next = normalizeSummaryCardsConfig(prev);
      const field = dashboardFieldForType("metric_sum" as any, fieldOptions, "value");
      next.cards.push({
        id: `card-${Date.now()}`,
        aggregation: "count",
        label: "New card",
        description: "",
        filter: { mode: "preset", preset: "all" },
        field,
      });
      return next;
    });
  };

  const removeCard = (idx: number) => {
    setConfig((prev) => {
      const next = normalizeSummaryCardsConfig(prev);
      next.cards = next.cards.filter((_, i) => i !== idx);
      return next.cards.length ? next : DEFAULT_SUMMARY_CARDS;
    });
  };

  const save = async () => {
    setSaveMsg(null);
    try {
      const res = await apiFetch<{ summaryCards?: SummaryCardsConfig }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ summaryCards: config }),
      });
      const next = normalizeSummaryCardsConfig(res.summaryCards || config);
      setConfig(next);
      setSaveMsg("Summary cards saved.");
      emitWorkspaceLayoutUpdated({ page: "summary-cards" });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading summary cards…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure the summary cards shown at the top of both Dashboard and Records.
      </p>

      <div className="space-y-3">
        {cards.map((card, idx) => (
          <div
            key={card.id}
            className="rounded-lg border border-border p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{card.label || `Card ${idx + 1}`}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeCard(idx)}
                title="Remove card"
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="Aggregation"
                value={card.aggregation}
                onChange={(e) => {
                  const aggregation = e.target.value as SummaryAggregation;
                  const field =
                    aggregation === "count"
                      ? ""
                      : dashboardFieldForType("metric_sum" as any, fieldOptions, card.field);
                  updateCard(idx, { aggregation, field });
                }}
                options={AGG_OPTIONS}
              />
              <Select
                label="Filter mode"
                value={(card.filter?.mode || "preset") as any}
                onChange={(e) => {
                  const mode = e.target.value as "preset" | "field";
                  if (mode === "field") {
                    updateCard(idx, {
                      filter: {
                        mode: "field",
                        field: fieldOptions[0]?.value || "status",
                        op: "eq",
                        value: "",
                      },
                    });
                  } else {
                    updateCard(idx, { filter: { mode: "preset", preset: "all" } });
                  }
                }}
                options={[
                  { value: "preset", label: "Preset" },
                  { value: "field", label: "Field filter" },
                ]}
              />

              {card.filter?.mode === "field" ? (
                <>
                  <Select
                    label="Filter field"
                    value={card.filter.field}
                    onChange={(e) =>
                      updateCard(idx, {
                        filter: { ...(card.filter as any), field: e.target.value },
                      })
                    }
                    options={fieldOptions.map((f) => ({ value: f.value, label: f.label }))}
                  />
                  <Select
                    label="Operator"
                    value={card.filter.op}
                    onChange={(e) =>
                      updateCard(idx, {
                        filter: { ...(card.filter as any), op: e.target.value as SummaryCardFilterOp },
                      })
                    }
                    options={FILTER_OP_OPTIONS}
                  />
                  {card.filter.op === "is_empty" || card.filter.op === "is_not_empty" ? (
                    <Input label="Value" value="" disabled onChange={() => undefined} />
                  ) : (
                    <Input
                      label="Value"
                      value={card.filter.value || ""}
                      onChange={(e) =>
                        updateCard(idx, {
                          filter: { ...(card.filter as any), value: e.target.value },
                        })
                      }
                      placeholder={card.filter.op === "in" ? "a, b, c" : "Value"}
                    />
                  )}
                </>
              ) : (
                <Select
                  label="Filter"
                  value={(card.filter?.mode === "preset" ? card.filter.preset : "all") as any}
                  onChange={(e) =>
                    updateCard(idx, { filter: { mode: "preset", preset: e.target.value as SummaryCardFilterPreset } })
                  }
                  options={FILTER_PRESET_OPTIONS}
                />
              )}
              {card.aggregation === "count" ? (
                <Select
                  label="Field"
                  value=""
                  disabled
                  options={[{ value: "", label: "N/A" }]}
                />
              ) : (
                <Select
                  label="Field"
                  value={card.field || ""}
                  onChange={(e) => updateCard(idx, { field: e.target.value })}
                  options={optionsForAgg(card.aggregation).map((f) => ({ value: f.value, label: f.label }))}
                />
              )}
              <Input
                label="Label"
                value={card.label}
                onChange={(e) => updateCard(idx, { label: e.target.value })}
              />
              <Input
                label="Description"
                value={card.description || ""}
                onChange={(e) => updateCard(idx, { description: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : <span />}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={addCard}>
            <Plus className="w-4 h-4" />
            Add card
          </Button>
          <Button type="button" onClick={() => void save()}>
            Save cards
          </Button>
        </div>
      </div>
    </div>
  );
}

