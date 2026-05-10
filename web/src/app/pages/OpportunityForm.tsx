import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Save, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuthUser } from "../contexts/AuthUserContext";

interface FormData {
  prospect: string;
  description: string;
  owner: string;
  deliverables: string;
  dueDate: string;
  status: string;
  winLoss: string;
  firstPresalesCall: string;
  closedDate: string;
  prospectType: string;
  engagementType: string;
  value: string;
  currency: string;
  notes: string;
}

const initialFormData: FormData = {
  prospect: "",
  description: "",
  owner: "",
  deliverables: "",
  dueDate: "",
  status: "Not Started",
  winLoss: "Open",
  firstPresalesCall: "",
  closedDate: "",
  prospectType: "",
  engagementType: "",
  value: "",
  currency: "USD",
  notes: "",
};

type ApiOpportunity = {
  id: string;
  prospect: string;
  opportunityDescription: string;
  ownerIds: string[];
  deliverables: string[];
  dueDate: string;
  status: string;
  notes: string;
  winOrLoss: string;
  firstPresalesCall?: string | null;
  closedDate?: string | null;
  prospectType: string;
  engagementType: string;
  value: number;
  currency: string;
  version: number;
};

const DEFAULT_PT = [
  { value: "", label: "Select type..." },
  { value: "Enterprise", label: "Enterprise" },
  { value: "Mid-Market", label: "Mid-Market" },
  { value: "SMB", label: "SMB" },
];
const DEFAULT_ET = [
  { value: "", label: "Select engagement..." },
  { value: "RFP", label: "RFP" },
  { value: "POC", label: "POC" },
  { value: "Demo", label: "Demo" },
  { value: "Consultation", label: "Consultation" },
];

export function OpportunityForm() {
  const params = useParams();
  /** edit route uses :id/edit; param is `id` */
  const editId = params.id;
  const navigate = useNavigate();
  const isEdit = !!editId;
  const { user } = useAuthUser();

  const [prospectTypeOptions, setProspectTypeOptions] = useState(DEFAULT_PT);
  const [engagementTypeOptions, setEngagementTypeOptions] = useState(DEFAULT_ET);

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [version, setVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {}
  );
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "VIEWER") {
      navigate("/app/opportunities", { replace: true });
    }
  }, [user?.role, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          prospectTypes: { value: string }[];
          engagementTypes: { value: string }[];
        }>("/settings/lookups");
        if (cancelled) return;
        const pt = (res.prospectTypes || []).map((x) => ({
          value: x.value,
          label: x.value,
        }));
        const et = (res.engagementTypes || []).map((x) => ({
          value: x.value,
          label: x.value,
        }));
        setProspectTypeOptions(
          [{ value: "", label: "Select type..." }].concat(pt.length ? pt : DEFAULT_PT.slice(1))
        );
        setEngagementTypeOptions(
          [{ value: "", label: "Select engagement..." }].concat(
            et.length ? et : DEFAULT_ET.slice(1)
          )
        );
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isEdit || !editId) return;
    let cancelled = false;
    (async () => {
      try {
        const o = await apiFetch<ApiOpportunity>(`/opportunities/${editId}`);
        if (cancelled) return;
        const ownerJoined = (o.ownerIds || []).join(", ");
        const del =
          Array.isArray(o.deliverables) && o.deliverables.length
            ? o.deliverables.join(", ")
            : "";
        setFormData({
          prospect: o.prospect,
          description: o.opportunityDescription,
          owner: ownerJoined,
          deliverables: del,
          dueDate: o.dueDate,
          status: o.status,
          winLoss: o.winOrLoss,
          firstPresalesCall: o.firstPresalesCall || "",
          closedDate: o.closedDate || "",
          prospectType: o.prospectType,
          engagementType: o.engagementType,
          value: String(o.value ?? ""),
          currency: o.currency || "USD",
          notes: o.notes || "",
        });
        setVersion(o.version);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load opportunity"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, editId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.prospect.trim()) {
      newErrors.prospect = "Prospect name is required";
    }

    if (!formData.description.trim()) {
      newErrors.description = "Description is required";
    }

    if (!formData.owner.trim()) {
      newErrors.owner = "Owner is required";
    }

    if (!formData.dueDate) {
      newErrors.dueDate = "Due date is required";
    }

    if (!formData.prospectType) {
      newErrors.prospectType = "Prospect type is required";
    }

    if (!formData.engagementType) {
      newErrors.engagementType = "Engagement type is required";
    }

    if (formData.value && isNaN(Number(formData.value))) {
      newErrors.value = "Value must be a number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const buildPayload = () => {
    const ownerIds = formData.owner
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const valueNum = formData.value === "" ? 0 : Number(formData.value);
    return {
      prospect: formData.prospect,
      opportunityDescription: formData.description,
      ownerIds,
      deliverables: formData.deliverables,
      dueDate: formData.dueDate,
      status: formData.status,
      notes: formData.notes,
      winOrLoss: formData.winLoss,
      firstPresalesCall: formData.firstPresalesCall || null,
      closedDate: formData.closedDate || null,
      prospectType: formData.prospectType,
      engagementType: formData.engagementType,
      value: valueNum,
      currency: formData.currency,
    };
  };

  const persist = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      if (isEdit && editId) {
        if (version === null) throw new Error("Missing version for update");
        await apiFetch(`/opportunities/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...buildPayload(),
            version,
          }),
        });
      } else {
        await apiFetch(`/opportunities`, {
          method: "POST",
          body: JSON.stringify(buildPayload()),
        });
      }
      navigate("/app/opportunities");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (msg.toLowerCase().includes("conflict")) {
        alert(
          "This record was modified elsewhere (version conflict). Reload the edit page."
        );
      } else {
        alert(msg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void persist();
  };

  const handleSaveDraft = () => void persist();

  if (isEdit && loadError) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">{loadError}</p>
        <Link to="/app/opportunities" className="text-primary underline">
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Breadcrumbs
        items={[
          { label: "Opportunities", href: "/app/opportunities" },
          { label: isEdit ? "Edit Opportunity" : "New Opportunity" },
        ]}
      />

      <div className="flex items-start justify-between">
        <div>
          <h1>{isEdit ? "Edit Opportunity" : "Create New Opportunity"}</h1>
          <p className="text-muted-foreground">
            {isEdit
              ? "Update opportunity details"
              : "Add a new presales opportunity to track"}
          </p>
        </div>
        <Link to="/app/opportunities">
          <Button variant="outline">
            <X className="w-4 h-4" />
            Cancel
          </Button>
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Prospect"
                name="prospect"
                value={formData.prospect}
                onChange={handleChange}
                error={errors.prospect}
                required
                placeholder="e.g., Acme Corporation"
              />

              <Input
                label="Owner"
                name="owner"
                value={formData.owner}
                onChange={handleChange}
                error={errors.owner}
                required
                placeholder="Name or comma-separated names"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm mb-1">
                Opportunity Description
                <span className="text-destructive ml-1">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className={`w-full px-3 py-2 bg-input-background rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.description ? "border-destructive" : "border-border"
                }`}
                placeholder="Brief description of the opportunity"
              />
              {errors.description && (
                <p className="text-sm text-destructive mt-1">
                  {errors.description}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="deliverables" className="block text-sm mb-1">
                Deliverables
              </label>
              <textarea
                id="deliverables"
                name="deliverables"
                value={formData.deliverables}
                onChange={handleChange}
                rows={2}
                className="w-full px-3 py-2 bg-input-background rounded-lg border border-border transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g., Proposal, Demo, Technical Architecture"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Prospect Type"
                name="prospectType"
                value={formData.prospectType}
                onChange={handleChange}
                error={errors.prospectType}
                required
                options={prospectTypeOptions}
              />

              <Select
                label="Type of Engagement"
                name="engagementType"
                value={formData.engagementType}
                onChange={handleChange}
                error={errors.engagementType}
                required
                options={engagementTypeOptions}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery Tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Due Date"
                name="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={handleChange}
                error={errors.dueDate}
                required
              />

              <Input
                label="First Presales Call"
                name="firstPresalesCall"
                type="date"
                value={formData.firstPresalesCall}
                onChange={handleChange}
              />

              <Input
                label="Closed Date"
                name="closedDate"
                type="date"
                value={formData.closedDate}
                onChange={handleChange}
                helperText="Leave empty if not closed"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                required
                options={[
                  { value: "Not Started", label: "Not Started" },
                  { value: "In Progress", label: "In Progress" },
                  { value: "Completed", label: "Completed" },
                ]}
              />

              <Select
                label="Win or Loss"
                name="winLoss"
                value={formData.winLoss}
                onChange={handleChange}
                required
                options={[
                  { value: "Open", label: "Open" },
                  { value: "Win", label: "Win" },
                  { value: "Loss", label: "Loss" },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commercial Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Value"
                name="value"
                type="number"
                value={formData.value}
                onChange={handleChange}
                error={errors.value}
                placeholder="0"
              />

              <Select
                label="Currency"
                name="currency"
                value={formData.currency}
                onChange={handleChange}
                required
                options={[
                  { value: "USD", label: "USD" },
                  { value: "EUR", label: "EUR" },
                  { value: "GBP", label: "GBP" },
                  { value: "CAD", label: "CAD" },
                ]}
              />
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm mb-1">
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                className="w-full px-3 py-2 bg-input-background rounded-lg border border-border transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Additional notes, stakeholder information, key requirements..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate("/app/opportunities")}>
            Discard
          </Button>
          <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving}>
            Save as Draft
          </Button>
          <Button type="submit" disabled={isSaving}>
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : isEdit ? "Update Opportunity" : "Create Opportunity"}
          </Button>
        </div>
      </form>
    </div>
  );
}
