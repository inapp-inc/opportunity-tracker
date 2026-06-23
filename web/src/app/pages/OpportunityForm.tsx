import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Link2, Save, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuthUser } from "../contexts/AuthUserContext";
import type {
  ApiOpportunity,
  TenantFieldDefinition,
} from "../lib/opportunity";
import { lowerFirst, useTerminology } from "../lib/terminology";
import {
  inputTypeForFieldType,
  isChoiceFieldType,
  isEmptyCustomValue,
  isMultiChoiceFieldType,
  isNumericFieldType,
  validateChoiceAgainstOptions,
  type CustomFieldValue,
} from "../lib/fields";
import {
  catalogEntriesForCategory,
  resolveFieldSelectOptions,
} from "../lib/lookupOptions";
import {
  useAssignableUsers,
  useCatalogLookups,
  useOnTenantLookupsUpdated,
  useTenantSchema,
} from "../lib/serverState";
import { PageHeader } from "../components/shared";
import { useCanCreateRecords, useCanEdit } from "../lib/roles";

interface FormData {
  prospect: string;
  description: string;
  ownerIds: string[];
  deliverables: string;
  dueDate: string;
  status: string;
  winLoss: string;
  dealStage: string;
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
  ownerIds: [],
  deliverables: "",
  dueDate: "",
  status: "Not Started",
  winLoss: "Open",
  dealStage: "Discovery",
  firstPresalesCall: "",
  closedDate: "",
  prospectType: "",
  engagementType: "",
  value: "",
  currency: "USD",
  notes: "",
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
const DEFAULT_WL = [
  { value: "", label: "Select outcome..." },
  { value: "Open", label: "Open" },
  { value: "Win", label: "Win" },
  { value: "Loss", label: "Loss" },
];
const DEFAULT_CURRENCY = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "CAD", label: "CAD" },
];

export function OpportunityForm() {
  const params = useParams();
  /** edit route uses :id/edit; param is `id` */
  const editId = params.id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = !!editId;
  const canCreate = useCanCreateRecords();
  const canUpdate = useCanEdit();
  const { user } = useAuthUser();
  const terminology = useTerminology();

  const { users: assignableUsers } = useAssignableUsers();
  const { fields: schemaFields, reload: reloadSchema } = useTenantSchema();
  const { lookups: catalogLookups, reload: reloadCatalog } = useCatalogLookups();

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [customFields, setCustomFields] = useState<Record<string, CustomFieldValue>>({});
  const [version, setVersion] = useState<number | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {}
  );
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emptyPrompt, setEmptyPrompt] = useState<{
    open: boolean;
    labels: string[];
    mode: "publish" | "draft";
  }>({ open: false, labels: [], mode: "publish" });
  const [prospectSuggestions, setProspectSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    const prospect = searchParams.get("prospect");
    if (prospect) {
      setFormData((prev) => ({ ...prev, prospect: decodeURIComponent(prospect) }));
    }
  }, [isEdit, searchParams]);

  useEffect(() => {
    if (isEdit && !canUpdate) {
      navigate("/app/opportunities", { replace: true });
      return;
    }
    if (!isEdit && !canCreate) {
      navigate("/app/opportunities", { replace: true });
    }
  }, [canCreate, canUpdate, isEdit, navigate]);

  useEffect(() => {
    if (isEdit || !user?.sub) return;
    setFormData((prev) =>
      prev.ownerIds.length ? prev : { ...prev, ownerIds: [user.sub] }
    );
  }, [isEdit, user?.sub]);

  const applyRecordToForm = useCallback(
    (o: ApiOpportunity) => {
      const del =
        Array.isArray(o.deliverables) && o.deliverables.length
          ? o.deliverables.join(", ")
          : "";
      setFormData({
        prospect: o.prospect,
        description: o.opportunityDescription,
        ownerIds: o.ownerIds || [],
        deliverables: del,
        dueDate: o.dueDate,
        status: o.status,
        winLoss: o.winOrLoss,
        dealStage: o.dealStage || "Discovery",
        firstPresalesCall: o.firstPresalesCall || "",
        closedDate: o.closedDate || "",
        prospectType: o.prospectType,
        engagementType: o.engagementType,
        value: String(o.value ?? ""),
        currency: o.currency || "USD",
        notes: o.notes || "",
      });
      setIsDraft(Boolean(o.isDraft));
      setCustomFields(() => {
        const src = o.customFields || {};
        const active = (schemaFields || []).filter((f) => f.status !== "INACTIVE");
        const allowed = new Set(
          active
            .filter((f) => f.source !== "system" || f.key === "techStack")
            .map((f) => f.key)
        );
        const out: Record<string, CustomFieldValue> = {};
        for (const [k, v] of Object.entries(src)) {
          if (allowed.has(k)) out[k] = v as CustomFieldValue;
        }
        return out;
      });
      setVersion(o.version);
      setLoadError(null);
    },
    [schemaFields]
  );

  const loadRecord = useCallback(async () => {
    if (!isEdit || !editId) return;
    try {
      const o = await apiFetch<ApiOpportunity>(`/records/${editId}`);
      applyRecordToForm(o);
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : `Failed to load ${lowerFirst(terminology.recordSingular)}`
      );
    }
  }, [applyRecordToForm, editId, isEdit, terminology.recordSingular]);

  useEffect(() => {
    if (!isEdit || !editId || schemaFields.length === 0) return;
    void loadRecord();
  }, [isEdit, editId, schemaFields, loadRecord]);

  useEffect(() => {
    void reloadCatalog();
    void reloadSchema();
  }, [editId, reloadCatalog, reloadSchema]);

  useOnTenantLookupsUpdated(
    useCallback(() => {
      void reloadCatalog();
      void reloadSchema();
      void loadRecord();
    }, [loadRecord, reloadCatalog, reloadSchema])
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleProspectInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, prospect: value }));
    if (errors.prospect) {
      setErrors((prev) => ({ ...prev, prospect: undefined }));
    }
    if (value.length >= 1) {
      void apiFetch<{ items: { name: string }[] }>(
        `/prospect-groups?q=${encodeURIComponent(value)}`
      )
        .then((res) => {
          setProspectSuggestions((res.items || []).map((item) => item.name));
          setShowSuggestions(true);
        })
        .catch(() => setProspectSuggestions([]));
    } else {
      setProspectSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectProspectSuggestion = (name: string) => {
    setShowSuggestions(false);
    void apiFetch<{ items: ApiOpportunity[] }>(
      `/prospect-groups/${encodeURIComponent(name)}/records`
    )
      .then((res) => {
        const items = res.items || [];
        if (items.length > 0) {
          setFormData((prev) => ({
            ...prev,
            prospect: name,
            description: items[0].opportunityDescription || prev.description,
            firstPresalesCall: items[0].firstPresalesCall || prev.firstPresalesCall,
            prospectType: items[0].prospectType || prev.prospectType,
            engagementType: items[0].engagementType || prev.engagementType,
            dealStage: items[0].dealStage || prev.dealStage,
            winLoss: items[0].winOrLoss || prev.winLoss,
            value: items[0].value ? String(items[0].value) : prev.value,
            currency: items[0].currency || prev.currency,
            ownerIds: items[0].ownerIds?.length ? items[0].ownerIds : prev.ownerIds,
          }));
        } else {
          setFormData((prev) => ({ ...prev, prospect: name }));
        }
      })
      .catch(() => {
        setFormData((prev) => ({ ...prev, prospect: name }));
      });
  };

  const setFormField = (name: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    const requiredFor = (key: string, fallback: boolean) =>
      fieldConfig(key)?.required ?? fallback;

    if (requiredFor("prospect", true) && !formData.prospect.trim()) {
      newErrors.prospect = "Prospect name is required";
    }

    if (
      requiredFor("opportunityDescription", true) &&
      !formData.description.trim()
    ) {
      newErrors.description = "Description is required";
    }

    if (requiredFor("ownerIds", true) && !formData.ownerIds.length) {
      newErrors.ownerIds = "Select at least one owner";
    }
    if (requiredFor("dealStage", true) && !formData.dealStage) {
      newErrors.dealStage = "Deal stage is required";
    }

    if (requiredFor("dueDate", true) && !formData.dueDate) {
      newErrors.dueDate = "Due date is required";
    }

    if (requiredFor("prospectType", true) && !formData.prospectType) {
      newErrors.prospectType = "Prospect type is required";
    }

    if (requiredFor("engagementType", true) && !formData.engagementType) {
      newErrors.engagementType = "Engagement type is required";
    }

    if (formData.value && isNaN(Number(formData.value))) {
      newErrors.value = "Value must be a number";
    }
    const deliverablesConfig = fieldConfig("deliverables");
    if (deliverablesConfig?.required && !formData.deliverables.trim()) {
      newErrors.deliverables = `${deliverablesConfig.label} is required`;
    }

    setErrors(newErrors);
    const nextCustomErrors: Record<string, string> = {};
    const fieldsToValidate = techStackField
      ? [
          ...customSchemaFields.filter((field) => field.key !== "techStack"),
          techStackField,
        ]
      : customSchemaFields;
    for (const field of fieldsToValidate) {
      const value = customFields[field.key];
      if (field.required && isEmptyCustomValue(value)) {
        nextCustomErrors[field.key] = `${field.label} is required`;
      }
      if (
        isNumericFieldType(field.fieldType) &&
        value !== undefined &&
        value !== "" &&
        isNaN(Number(value))
      ) {
        nextCustomErrors[field.key] = `${field.label} must be a number`;
      }
    }
    setCustomErrors(nextCustomErrors);
    return Object.keys(newErrors).length === 0 && Object.keys(nextCustomErrors).length === 0;
  };

  const handleCustomFieldChange = (
    key: string,
    value: CustomFieldValue
  ) => {
    setCustomFields((prev) => ({ ...prev, [key]: value }));
    if (customErrors[key]) {
      setCustomErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const toggleOwner = (userId: string) => {
    setFormData((prev) => {
      const has = prev.ownerIds.includes(userId);
      const ownerIds = has
        ? prev.ownerIds.filter((id) => id !== userId)
        : [...prev.ownerIds, userId];
      return { ...prev, ownerIds };
    });
    if (errors.ownerIds) {
      setErrors((prev) => ({ ...prev, ownerIds: undefined }));
    }
  };

  const buildPayload = () => {
    const valueNum = formData.value === "" ? 0 : Number(formData.value);
    const sanitizeCustomFields = () => {
      const active = schemaFields.filter((f) => f.status !== "INACTIVE");
      const allowed = new Set(
        active
          .filter((f) => f.source !== "system" || f.key === "techStack")
          .map((f) => f.key)
      );
      const out: Record<string, CustomFieldValue> = {};
      for (const [k, v] of Object.entries(customFields)) {
        if (allowed.has(k)) out[k] = v;
      }
      return out;
    };
    return {
      prospect: formData.prospect,
      opportunityDescription: formData.description,
      ownerIds: formData.ownerIds,
      deliverables: formData.deliverables,
      dueDate: formData.dueDate,
      status: formData.status,
      dealStage: formData.dealStage,
      customFields: sanitizeCustomFields(),
      notes: formData.notes,
      winOrLoss: formData.winLoss,
      firstPresalesCall: formData.firstPresalesCall || null,
      closedDate: formData.closedDate || null,
      prospectType: formData.prospectType,
      engagementType: formData.engagementType,
      value: valueNum,
      currency: formData.currency,
      isDraft,
    };
  };

  const systemFieldFormValue = (key: string): string | undefined => {
    if (key === "opportunityDescription") return formData.description;
    if (key === "ownerIds") return undefined;
    if (key in formData) return String(formData[key as keyof FormData] ?? "");
    return undefined;
  };

  const validateSchemaChoices = (): string | null => {
    for (const field of schemaFields.filter((item) => item.status !== "INACTIVE")) {
      if (!isChoiceFieldType(field.fieldType)) continue;
      const multi = isMultiChoiceFieldType(field.fieldType);
      const raw =
        field.source === "system"
          ? systemFieldFormValue(field.key)
          : customFields[field.key];
      const err = validateChoiceAgainstOptions(
        field.label,
        raw,
        field.options || [],
        multi
      );
      if (err) return err;
    }
    return null;
  };

  const persist = async (mode: "publish" | "draft", bypassEmptyPrompt = false) => {
    const nextIsDraft = mode === "draft";
    setIsDraft(nextIsDraft);
    if (!nextIsDraft && !validate()) return;
    const choiceErr = validateSchemaChoices();
    if (choiceErr) {
      alert(choiceErr);
      return;
    }

    if (!bypassEmptyPrompt) {
      const empties: string[] = [];
      const isEmpty = (v: unknown) => {
        if (v === undefined || v === null) return true;
        if (typeof v === "string") return v.trim() === "";
        if (Array.isArray(v)) return v.length === 0;
        return false;
      };
      const addIfEmpty = (key: string, fallbackLabel: string, value: unknown) => {
        if (!fieldVisible(key)) return;
        if (isEmpty(value)) empties.push(fieldLabel(key, fallbackLabel));
      };

      addIfEmpty("prospect", "Prospect", formData.prospect);
      addIfEmpty("ownerIds", "Owners", formData.ownerIds);
      addIfEmpty("opportunityDescription", "Description", formData.description);
      addIfEmpty("deliverables", "Deliverables", formData.deliverables);
      addIfEmpty("dueDate", "Due Date", formData.dueDate);
      addIfEmpty("status", "Status", formData.status);
      addIfEmpty("prospectType", "Prospect Type", formData.prospectType);
      addIfEmpty("engagementType", "Type of Engagement", formData.engagementType);
      addIfEmpty("dealStage", "Deal stage", formData.dealStage);
      addIfEmpty("winOrLoss", "Win or Loss", formData.winLoss);
      addIfEmpty("firstPresalesCall", "First Presales Call", formData.firstPresalesCall);
      addIfEmpty("closedDate", "Closed Date", formData.closedDate);
      addIfEmpty("notes", "Notes", formData.notes);
      addIfEmpty("value", "Value", formData.value);
      addIfEmpty("currency", "Currency", formData.currency);

      if (techStackField && isEmpty(customFields.techStack)) empties.push(techStackField.label);
      for (const field of customSchemaFields) {
        if (isEmpty(customFields[field.key])) empties.push(field.label);
      }

      if (empties.length) {
        setEmptyPrompt({ open: true, labels: Array.from(new Set(empties)), mode });
        return;
      }
    }

    setIsSaving(true);
    try {
      if (isEdit && editId) {
        if (!canUpdate) throw new Error("You do not have permission for this action.");
        if (version === null) throw new Error("Missing version for update");
        await apiFetch(`/records/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...buildPayload(),
            isDraft: nextIsDraft,
            version,
          }),
        });
      } else {
        if (!canCreate) throw new Error("You do not have permission for this action.");
        await apiFetch(`/records`, {
          method: "POST",
          body: JSON.stringify({ ...buildPayload(), isDraft: nextIsDraft }),
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
    void persist("publish");
  };

  const activeSchemaFields = useMemo(
    () => schemaFields.filter((field) => field.status !== "INACTIVE"),
    [schemaFields]
  );
  const fieldConfig = useCallback(
    (key: string) => activeSchemaFields.find((field) => field.key === key),
    [activeSchemaFields]
  );
  const prospectTypeSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("prospectType"),
        catalogLookups?.prospectTypes,
        DEFAULT_PT,
        "Select type..."
      ),
    [catalogLookups, activeSchemaFields, fieldConfig]
  );
  const engagementTypeSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("engagementType"),
        catalogLookups?.engagementTypes,
        DEFAULT_ET,
        "Select engagement..."
      ),
    [catalogLookups, activeSchemaFields, fieldConfig]
  );
  const dealStageSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("dealStage"),
        catalogLookups?.dealStages,
        [{ value: "Discovery", label: "Discovery" }]
      ),
    [catalogLookups, activeSchemaFields, fieldConfig]
  );
  const statusSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(fieldConfig("status"), [], [
        { value: "Not Started", label: "Not Started" },
        { value: "In Progress", label: "In Progress" },
        { value: "Completed", label: "Completed" },
      ]),
    [activeSchemaFields, fieldConfig]
  );
  const winLossSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("winOrLoss"),
        catalogLookups?.winLoss,
        DEFAULT_WL,
        "Select outcome..."
      ),
    [catalogLookups, activeSchemaFields, fieldConfig]
  );
  const currencySelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("currency"),
        catalogLookups?.currencies,
        DEFAULT_CURRENCY
      ),
    [catalogLookups, activeSchemaFields, fieldConfig]
  );
  const deliverablesSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("deliverables"),
        catalogEntriesForCategory(catalogLookups, fieldConfig("deliverables")?.lookupCategory),
        [{ value: "", label: "Select..." }]
      ),
    [catalogLookups, activeSchemaFields, fieldConfig]
  );

  if (isEdit && loadError) {
    return (
    <div className="mx-auto max-w-screen-2xl p-6 space-y-4">
        <p className="text-destructive">{loadError}</p>
        <Link to="/app/opportunities" className="text-primary underline">
          Back to list
        </Link>
      </div>
    );
  }

  const customSchemaFields = activeSchemaFields.filter((field) => field.source !== "system");
  const techStackField = activeSchemaFields.find((field) => field.key === "techStack");
  const anyFieldConfig = (key: string) => schemaFields.find((field) => field.key === key);
  const fieldLabel = (key: string, fallback: string) => fieldConfig(key)?.label || fallback;
  const fieldVisible = (key: string) => anyFieldConfig(key)?.status !== "INACTIVE";
  const fieldRequired = (key: string, fallback: boolean) =>
    fieldConfig(key)?.required ?? fallback;

  const renderDeliverablesField = () => {
    const field = fieldConfig("deliverables");
    const label = field?.label || "Deliverables";
    const options = deliverablesSelectOptions
      .map((option) => option.value)
      .filter(Boolean);
    const selectedValues = formData.deliverables
      .split(/[;,|]/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (field?.fieldType === "select" || field?.fieldType === "lookup_select") {
      return (
        <Select
          label={label}
          name="deliverables"
          value={formData.deliverables}
          onChange={handleChange}
          required={field.required}
          error={errors.deliverables}
          options={deliverablesSelectOptions}
        />
      );
    }

    if (field?.fieldType === "multi_select" || field?.fieldType === "lookup_multi_select") {
      return (
        <div className="space-y-2">
          <p className="text-sm">
            {label}
            {field.required ? <span className="text-destructive ml-1">*</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selectedValues, option]
                      : selectedValues.filter((value) => value !== option);
                    setFormField("deliverables", next.join(", "));
                  }}
                />
                {option}
              </label>
            ))}
          </div>
          {errors.deliverables ? (
            <p className="text-sm text-destructive mt-1">{errors.deliverables}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div>
        <label htmlFor="deliverables" className="block text-sm mb-1">
          {label}
          {field?.required ? <span className="text-destructive ml-1">*</span> : null}
        </label>
        <textarea
          id="deliverables"
          name="deliverables"
          value={formData.deliverables}
          onChange={handleChange}
          rows={2}
          className={`w-full px-3 py-2 bg-input-background rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
            errors.deliverables ? "border-destructive" : "border-border"
          }`}
          placeholder="e.g., Proposal, Demo, Technical Architecture"
        />
        {errors.deliverables ? (
          <p className="text-sm text-destructive mt-1">{errors.deliverables}</p>
        ) : null}
      </div>
    );
  };

  const renderCustomField = (field: TenantFieldDefinition) => {
    const value = customFields[field.key];
    const selectedValues = Array.isArray(value) ? value : [];
    const common = {
      id: `custom-${field.key}`,
      name: field.key,
      value:
        value === undefined || typeof value === "boolean" || Array.isArray(value)
          ? ""
          : String(value),
      required: field.required,
    };

    if (field.fieldType === "select" || field.fieldType === "lookup_select") {
      const customSelectOptions = resolveFieldSelectOptions(
        field,
        catalogEntriesForCategory(catalogLookups, field.lookupCategory),
        [{ value: "", label: "Select..." }],
        "Select..."
      );
      return (
        <Select
          key={field.id}
          label={field.label}
          value={String(value || "")}
          onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
          error={customErrors[field.key]}
          required={field.required}
          options={customSelectOptions}
        />
      );
    }

    if (field.fieldType === "multi_select" || field.fieldType === "lookup_multi_select") {
      const multiOptions = resolveFieldSelectOptions(
        field,
        catalogEntriesForCategory(catalogLookups, field.lookupCategory),
        (field.options || []).map((option) => ({ value: option, label: option }))
      )
        .map((option) => option.value)
        .filter(Boolean);
      return (
        <div key={field.id} className="space-y-2">
          <p className="text-sm">
            {field.label}
            {field.required ? <span className="text-destructive ml-1">*</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            {multiOptions.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selectedValues, option]
                      : selectedValues.filter((x) => x !== option);
                    handleCustomFieldChange(field.key, next);
                  }}
                />
                {option}
              </label>
            ))}
          </div>
          {customErrors[field.key] ? (
            <p className="text-sm text-destructive mt-1">{customErrors[field.key]}</p>
          ) : null}
        </div>
      );
    }

    if (field.fieldType === "boolean") {
      return (
        <label
          key={field.id}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
        >
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => handleCustomFieldChange(field.key, e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    }

    if (field.fieldType === "textarea") {
      return (
        <div key={field.id}>
          <label htmlFor={`custom-${field.key}`} className="block text-sm mb-1">
            {field.label}
            {field.required ? <span className="text-destructive ml-1">*</span> : null}
          </label>
          <textarea
            {...common}
            rows={3}
            onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
            className={`w-full px-3 py-2 bg-input-background rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
              customErrors[field.key] ? "border-destructive" : "border-border"
            }`}
          />
          {customErrors[field.key] ? (
            <p className="text-sm text-destructive mt-1">{customErrors[field.key]}</p>
          ) : null}
        </div>
      );
    }

    return (
      <Input
        key={field.id}
        label={field.label}
        type={inputTypeForFieldType(field.fieldType)}
        {...common}
        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
        error={customErrors[field.key]}
      />
    );
  };

  return (
    <div className="mx-auto max-w-screen-2xl p-6 space-y-6">
      <Modal
        isOpen={emptyPrompt.open}
        onClose={() => setEmptyPrompt({ open: false, labels: [], mode: "publish" })}
        title="Some fields are empty"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEmptyPrompt({ open: false, labels: [], mode: "publish" })}
            >
              Go back
            </Button>
            <Button
              type="button"
              onClick={() => {
                const mode = emptyPrompt.mode;
                setEmptyPrompt({ open: false, labels: [], mode: "publish" });
                void persist(mode, true);
              }}
            >
              Save anyway
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">These fields are currently empty:</p>
        <ul className="mt-3 list-disc pl-5 text-sm space-y-1">
          {emptyPrompt.labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </Modal>
      <Breadcrumbs
        items={[
          { label: terminology.recordPlural, href: "/app/opportunities" },
          {
            label: isEdit
              ? `Edit ${terminology.recordSingular}`
              : `New ${terminology.recordSingular}`,
          },
        ]}
      />

      <PageHeader
        eyebrow={terminology.recordSingular}
        title={
          isEdit
            ? `Edit ${terminology.recordSingular}`
            : `Create New ${terminology.recordSingular}`
        }
        description={
          isEdit
            ? `Update ${lowerFirst(terminology.recordSingular)} details`
            : `Add a new ${lowerFirst(terminology.recordSingular)} to track`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {isEdit && editId ? (
              <Link to={`/app/opportunities/${editId}?tab=artifacts`}>
                <Button variant="outline" type="button">
                  <Link2 className="w-4 h-4" />
                  Artifacts
                </Button>
              </Link>
            ) : null}
            <Link to="/app/opportunities">
              <Button variant="outline" type="button">
                <X className="w-4 h-4" />
                Cancel
              </Button>
            </Link>
          </div>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <Input
                  label={fieldLabel("prospect", "Prospect")}
                  name="prospect"
                  value={formData.prospect}
                  onChange={handleProspectInput}
                  onFocus={() => {
                    if (formData.prospect.length >= 1) setShowSuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  error={errors.prospect}
                  required={fieldRequired("prospect", true)}
                  placeholder="e.g., Acme Corporation"
                />
                {showSuggestions && prospectSuggestions.length > 0 ? (
                  <ul className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {prospectSuggestions.map((name) => (
                      <li
                        key={name}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                        onMouseDown={() => selectProspectSuggestion(name)}
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

            </div>

            <div>
              <p className="text-sm mb-2">
                {fieldLabel("ownerIds", "Owners")}
                {fieldRequired("ownerIds", true) ? (
                  <span className="text-destructive ml-1">*</span>
                ) : null}
              </p>
              {assignableUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading team members…</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {assignableUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-sm cursor-pointer border border-border rounded-lg px-3 py-2 hover:bg-accent/50"
                    >
                      <input
                        type="checkbox"
                        checked={formData.ownerIds.includes(u.id)}
                        onChange={() => toggleOwner(u.id)}
                      />
                      <span>{u.name}</span>
                      <span className="text-muted-foreground text-xs">{u.email}</span>
                    </label>
                  ))}
                </div>
              )}
              {errors.ownerIds ? (
                <p className="text-sm text-destructive mt-1">{errors.ownerIds}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="description" className="block text-sm mb-1">
                {fieldLabel("opportunityDescription", `${terminology.recordSingular} Description`)}
                {fieldRequired("opportunityDescription", true) ? (
                  <span className="text-destructive ml-1">*</span>
                ) : null}
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
                placeholder={`Brief description of the ${lowerFirst(terminology.recordSingular)}`}
              />
              {errors.description && (
                <p className="text-sm text-destructive mt-1">
                  {errors.description}
                </p>
              )}
            </div>

            {fieldVisible("deliverables") ? (
              renderDeliverablesField()
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label={fieldLabel("prospectType", "Prospect Type")}
                name="prospectType"
                value={formData.prospectType}
                onChange={handleChange}
                error={errors.prospectType}
                required={fieldRequired("prospectType", true)}
                options={prospectTypeSelectOptions}
              />

              <Select
                label={fieldLabel("engagementType", "Type of Engagement")}
                name="engagementType"
                value={formData.engagementType}
                onChange={handleChange}
                error={errors.engagementType}
                required={fieldRequired("engagementType", true)}
                options={engagementTypeSelectOptions}
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
                label={fieldLabel("dueDate", "Due Date")}
                name="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={handleChange}
                error={errors.dueDate}
                required={fieldRequired("dueDate", true)}
              />

              {fieldVisible("firstPresalesCall") ? (
                <Input
                  label={fieldLabel("firstPresalesCall", "First Presales Call")}
                  name="firstPresalesCall"
                  type="date"
                  value={formData.firstPresalesCall}
                  onChange={handleChange}
                />
              ) : null}

              {fieldVisible("closedDate") ? (
                <Input
                  label={fieldLabel("closedDate", "Closed Date")}
                  name="closedDate"
                  type="date"
                  value={formData.closedDate}
                  onChange={handleChange}
                  helperText="Leave empty if not closed"
                />
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select
                label={fieldLabel("dealStage", "Deal stage")}
                name="dealStage"
                value={formData.dealStage}
                onChange={handleChange}
                error={errors.dealStage}
                required={fieldRequired("dealStage", true)}
                options={dealStageSelectOptions}
              />

              <Select
                label={fieldLabel("status", "Status")}
                name="status"
                value={formData.status}
                onChange={handleChange}
                required={fieldRequired("status", true)}
                options={statusSelectOptions}
              />

              <Select
                label={fieldLabel("winOrLoss", "Win or Loss")}
                name="winLoss"
                value={formData.winLoss}
                onChange={handleChange}
                required={fieldRequired("winOrLoss", true)}
                options={winLossSelectOptions}
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
              {fieldVisible("value") ? (
                <Input
                  label={fieldLabel("value", "Value")}
                  name="value"
                  type="number"
                  value={formData.value}
                  onChange={handleChange}
                  error={errors.value}
                  placeholder="0"
                />
              ) : null}

              {fieldVisible("currency") ? (
                <Select
                  label={fieldLabel("currency", "Currency")}
                  name="currency"
                  value={formData.currency}
                  onChange={handleChange}
                  required={fieldRequired("currency", true)}
                  options={currencySelectOptions}
                />
              ) : null}
            </div>

            {customSchemaFields.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {customSchemaFields.map((field) => renderCustomField(field))}
              </div>
            ) : null}

            {techStackField && fieldVisible("techStack")
              ? renderCustomField(techStackField)
              : null}

            {fieldVisible("notes") ? (
              <div>
                <label htmlFor="notes" className="block text-sm mb-1">
                  {fieldLabel("notes", "Notes")}
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
            ) : null}
          </CardContent>
        </Card>
          </div>
          <aside className="space-y-6">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle>Save {terminology.recordSingular}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Review required fields and save the latest workspace schema values.
                </p>
                <div className="flex flex-col gap-3">
                  <Button type="submit" disabled={isSaving || (isEdit ? !canUpdate : !canCreate)}>
                    <Save className="w-4 h-4" />
                    {isSaving
                      ? "Saving..."
                      : isEdit
                        ? `Update ${terminology.recordSingular}`
                        : `Create ${terminology.recordSingular}`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving || (isEdit ? !canUpdate : !canCreate)}
                    onClick={() => void persist("draft")}
                  >
                    Save draft
                  </Button>
                  {isEdit && editId ? (
                    <Link to={`/app/opportunities/${editId}?tab=artifacts`}>
                      <Button type="button" variant="outline">
                        <Link2 className="w-4 h-4" />
                        Edit artifacts
                      </Button>
                    </Link>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => navigate("/app/opportunities")}>
                    Discard
                  </Button>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-3 xl:hidden">
          <Button type="button" variant="outline" onClick={() => navigate("/app/opportunities")}>
            Discard
          </Button>
          <Button type="submit" disabled={isSaving || (isEdit ? !canUpdate : !canCreate)}>
            <Save className="w-4 h-4" />
            {isSaving
              ? "Saving..."
              : isEdit
                ? `Update ${terminology.recordSingular}`
                : `Create ${terminology.recordSingular}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
