import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Link2, Save, X, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuthUser } from "../contexts/AuthUserContext";
import type {
  ApiOpportunity,
  OpportunityDeliverable,
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
  prospectType: string;
  engagementType: string;
  firstPresalesCall: string;
  dealStage: string;
  status: string;
  winOrLoss: string;
  value: string;
  currency: string;
}

type DeliverableFormItem = {
  id: string;
  deliverableType: string;
  dueDate: string;
  startDate: string;
  closedDate: string;
  notes: string;
};

function createBlankDeliverable(): DeliverableFormItem {
  return {
    id: crypto.randomUUID(),
    deliverableType: "",
    dueDate: "",
    startDate: "",
    closedDate: "",
    notes: "",
  };
}

const initialFormData: FormData = {
  prospect: "",
  description: "",
  ownerIds: [],
  prospectType: "",
  engagementType: "",
  firstPresalesCall: "",
  dealStage: "Discovery",
  status: "Not Started",
  winOrLoss: "Open",
  value: "",
  currency: "USD",
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
  const isEdit = !!editId;
  const canCreate = useCanCreateRecords();
  const canUpdate = useCanEdit();
  const { user } = useAuthUser();
  const terminology = useTerminology();

  const { users: assignableUsers } = useAssignableUsers();
  const { fields: schemaFields, reload: reloadSchema } = useTenantSchema();
  const { lookups: catalogLookups, reload: reloadCatalog } = useCatalogLookups();

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [deliverableItems, setDeliverableItems] = useState<DeliverableFormItem[]>([
    createBlankDeliverable(),
  ]);
  const [customFields, setCustomFields] = useState<Record<string, CustomFieldValue>>({});
  const [version, setVersion] = useState<number | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {}
  );
  const [deliverableErrors, setDeliverableErrors] = useState<
    Record<number, Partial<Record<keyof DeliverableFormItem, string>>>
  >({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emptyPrompt, setEmptyPrompt] = useState<{
    open: boolean;
    labels: string[];
    mode: "publish" | "draft";
  }>({ open: false, labels: [], mode: "publish" });

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
      setFormData({
        prospect: o.prospect,
        description: o.opportunityDescription,
        ownerIds: o.ownerIds || [],
        prospectType: o.prospectType,
        engagementType: o.engagementType,
        firstPresalesCall: o.firstPresalesCall || "",
        dealStage: o.dealStage || "Discovery",
        status: o.status,
        winOrLoss: o.winOrLoss,
        value: String(o.value ?? ""),
        currency: o.currency || "USD",
      });
      if (o.deliverableItems?.length) {
        setDeliverableItems(
          o.deliverableItems.map((d: OpportunityDeliverable) => ({
            id: d.id,
            deliverableType: d.deliverableType,
            dueDate: d.dueDate,
            startDate: d.startDate || "",
            closedDate: d.closedDate || "",
            notes: d.notes || "",
          }))
        );
      } else {
        const del =
          Array.isArray(o.deliverables) && o.deliverables.length
            ? o.deliverables.join(", ")
            : "";
        setDeliverableItems([
          {
            id: crypto.randomUUID(),
            deliverableType: del,
            dueDate: o.dueDate,
            startDate: "",
            closedDate: o.closedDate || "",
            notes: o.notes || "",
          },
        ]);
      }
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

  const updateDeliverableItem = (
    index: number,
    field: keyof DeliverableFormItem,
    value: string
  ) => {
    setDeliverableItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
    if (deliverableErrors[index]?.[field]) {
      setDeliverableErrors((prev) => {
        const next = { ...prev };
        if (next[index]) {
          const itemErrors = { ...next[index] };
          delete itemErrors[field];
          if (Object.keys(itemErrors).length === 0) {
            delete next[index];
          } else {
            next[index] = itemErrors;
          }
        }
        return next;
      });
    }
  };

  const removeDeliverableItem = (index: number) => {
    setDeliverableItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)
    );
    setDeliverableErrors((prev) => {
      const next: Record<number, Partial<Record<keyof DeliverableFormItem, string>>> = {};
      for (const [key, value] of Object.entries(prev)) {
        const i = Number(key);
        if (i < index) next[i] = value;
        else if (i > index) next[i - 1] = value;
      }
      return next;
    });
  };

  const addDeliverableItem = () => {
    setDeliverableItems((prev) => [...prev, createBlankDeliverable()]);
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    const newDeliverableErrors: Record<
      number,
      Partial<Record<keyof DeliverableFormItem, string>>
    > = {};
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

    if (requiredFor("prospectType", true) && !formData.prospectType) {
      newErrors.prospectType = "Prospect type is required";
    }

    if (requiredFor("engagementType", true) && !formData.engagementType) {
      newErrors.engagementType = "Engagement type is required";
    }

    if (requiredFor("dealStage", true) && !formData.dealStage) {
      newErrors.dealStage = "Deal stage is required";
    }

    if (formData.value && isNaN(Number(formData.value))) {
      newErrors.value = "Value must be a number";
    }

    if (deliverableItems.length === 0) {
      newDeliverableErrors[0] = {
        deliverableType: "At least one deliverable is required",
      };
    }

    deliverableItems.forEach((item, index) => {
      if (requiredFor("dueDate", true) && !item.dueDate) {
        newDeliverableErrors[index] = {
          ...newDeliverableErrors[index],
          dueDate: "Due date is required",
        };
      }
      if (!isDraft && !item.deliverableType.trim()) {
        newDeliverableErrors[index] = {
          ...newDeliverableErrors[index],
          deliverableType: "Deliverable type is required",
        };
      }
    });

    setErrors(newErrors);
    setDeliverableErrors(newDeliverableErrors);
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
    return (
      Object.keys(newErrors).length === 0 &&
      Object.keys(nextCustomErrors).length === 0 &&
      Object.keys(newDeliverableErrors).length === 0
    );
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
      deliverableItems: deliverableItems.map((item) => ({
        id: item.id,
        deliverableType: item.deliverableType,
        dueDate: item.dueDate,
        startDate: item.startDate || null,
        closedDate: item.closedDate || null,
        notes: item.notes,
      })),
      customFields: sanitizeCustomFields(),
      prospectType: formData.prospectType,
      engagementType: formData.engagementType,
      firstPresalesCall: formData.firstPresalesCall || null,
      dealStage: formData.dealStage,
      status: formData.status,
      winOrLoss: formData.winOrLoss,
      value: Number(formData.value) || 0,
      currency: formData.currency,
      isDraft,
    };
  };

  const systemFieldFormValue = (key: string): string | undefined => {
    if (key === "opportunityDescription") return formData.description;
    if (key === "ownerIds") return undefined;
    if (key in formData) return String(formData[key as keyof FormData] ?? "");
    if (deliverableItems.length > 0) {
      const first = deliverableItems[0];
      if (key === "dueDate") return first.dueDate;
      if (key === "closedDate") return first.closedDate;
      if (key === "notes") return first.notes;
      if (key === "deliverables") return first.deliverableType;
    }
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
      addIfEmpty("prospectType", "Prospect Type", formData.prospectType);
      addIfEmpty("engagementType", "Type of Engagement", formData.engagementType);
      addIfEmpty("firstPresalesCall", "First Presales Call", formData.firstPresalesCall);
      addIfEmpty("dealStage", "Deal stage", formData.dealStage);
      addIfEmpty("status", "Status", formData.status);
      addIfEmpty("winOrLoss", "Win or Loss", formData.winOrLoss);
      addIfEmpty("value", "Value", formData.value);
      addIfEmpty("currency", "Currency", formData.currency);

      deliverableItems.forEach((item, index) => {
        const prefix = deliverableItems.length > 1 ? `Deliverable ${index + 1} — ` : "";
        if (fieldVisible("deliverables") && !item.deliverableType.trim()) {
          empties.push(`${prefix}Deliverable Type`);
        }
        if (fieldVisible("dueDate") && !item.dueDate) {
          empties.push(`${prefix}Due Date`);
        }
        if (fieldVisible("closedDate") && !item.closedDate) {
          empties.push(`${prefix}Closed Date`);
        }
        if (fieldVisible("notes") && !item.notes.trim()) {
          empties.push(`${prefix}Notes`);
        }
      });

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
              <Input
                label={fieldLabel("prospect", "Prospect")}
                name="prospect"
                value={formData.prospect}
                onChange={handleChange}
                error={errors.prospect}
                required={fieldRequired("prospect", true)}
                placeholder="e.g., Acme Corporation"
              />

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

            {fieldVisible("firstPresalesCall") ? (
              <Input
                label={fieldLabel("firstPresalesCall", "First Presales Call")}
                name="firstPresalesCall"
                type="date"
                value={formData.firstPresalesCall}
                onChange={handleChange}
              />
            ) : null}

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
                name="winOrLoss"
                value={formData.winOrLoss}
                onChange={handleChange}
                required={fieldRequired("winOrLoss", true)}
                options={winLossSelectOptions}
              />
            </div>

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
          </CardContent>
        </Card>

        {deliverableItems.map((item, index) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Deliverable {index + 1}</CardTitle>
                {deliverableItems.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeDeliverableItem(index)}
                    aria-label={`Remove deliverable ${index + 1}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {fieldVisible("deliverables") ? (
                <Select
                  label="Deliverable Type"
                  value={item.deliverableType}
                  onChange={(e) =>
                    updateDeliverableItem(index, "deliverableType", e.target.value)
                  }
                  error={deliverableErrors[index]?.deliverableType}
                  required={fieldRequired("deliverables", !isDraft)}
                  options={deliverablesSelectOptions}
                />
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label={fieldLabel("dueDate", "Due Date")}
                  type="date"
                  value={item.dueDate}
                  onChange={(e) =>
                    updateDeliverableItem(index, "dueDate", e.target.value)
                  }
                  error={deliverableErrors[index]?.dueDate}
                  required={fieldRequired("dueDate", true)}
                />

                <Input
                  label="Build Start Date"
                  type="date"
                  value={item.startDate}
                  onChange={(e) =>
                    updateDeliverableItem(index, "startDate", e.target.value)
                  }
                />

                {fieldVisible("closedDate") ? (
                  <Input
                    label={fieldLabel("closedDate", "Closed Date")}
                    type="date"
                    value={item.closedDate}
                    onChange={(e) =>
                      updateDeliverableItem(index, "closedDate", e.target.value)
                    }
                    helperText="Leave empty if not closed"
                  />
                ) : null}
              </div>

              {fieldVisible("notes") ? (
                <div>
                  <label
                    htmlFor={`deliverable-notes-${item.id}`}
                    className="block text-sm mb-1"
                  >
                    {fieldLabel("notes", "Notes")}
                  </label>
                  <textarea
                    id={`deliverable-notes-${item.id}`}
                    value={item.notes}
                    onChange={(e) =>
                      updateDeliverableItem(index, "notes", e.target.value)
                    }
                    rows={4}
                    className="w-full px-3 py-2 bg-input-background rounded-lg border border-border transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Additional notes, stakeholder information, key requirements..."
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}

        <Button type="button" variant="outline" onClick={addDeliverableItem}>
          <Plus className="w-4 h-4" />
          Add Deliverable
        </Button>

        {customSchemaFields.length > 0 ||
        (techStackField && fieldVisible("techStack")) ? (
        <Card>
          <CardHeader>
            <CardTitle>Commercial Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {customSchemaFields.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {customSchemaFields.map((field) => renderCustomField(field))}
              </div>
            ) : null}

            {techStackField && fieldVisible("techStack")
              ? renderCustomField(techStackField)
              : null}
          </CardContent>
        </Card>
        ) : null}
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
