import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { apiFetch } from "../lib/api";
import { useAuthUser } from "../contexts/AuthUserContext";
import type { ApiOpportunity, TenantFieldDefinition } from "../lib/opportunity";
import { lowerFirst, useTerminology } from "../lib/terminology";
import {
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
  useCatalogLookups,
  useOnTenantLookupsUpdated,
  useTenantSchema,
} from "../lib/serverState";
import { useCanCreateRecords, useCanEdit } from "../lib/roles";
import {
  DEFAULT_CURRENCY_OPTIONS,
  DEFAULT_ENGAGEMENT_TYPE_OPTIONS,
  DEFAULT_PROSPECT_TYPE_OPTIONS,
  DEFAULT_WIN_LOSS_OPTIONS,
  initialOpportunityFormData,
  type OpportunityFormData,
} from "./opportunity/formDefaults";

export type { OpportunityFormData };

export function useOpportunityForm(editId: string | undefined) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = !!editId;
  const canCreate = useCanCreateRecords();
  const canUpdate = useCanEdit();
  const { user } = useAuthUser();
  const terminology = useTerminology();

  const { fields: schemaFields, reload: reloadSchema } = useTenantSchema();
  const { lookups: catalogLookups, reload: reloadCatalog } = useCatalogLookups();

  const [formData, setFormData] = useState<OpportunityFormData>(initialOpportunityFormData);
  const [customFields, setCustomFields] = useState<Record<string, CustomFieldValue>>({});
  const [version, setVersion] = useState<number | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof OpportunityFormData, string>>>({});
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

  const activeSchemaFields = useMemo(
    () => schemaFields.filter((field) => field.status !== "INACTIVE"),
    [schemaFields]
  );

  const fieldConfig = useCallback(
    (key: string) => activeSchemaFields.find((field) => field.key === key),
    [activeSchemaFields]
  );

  const customSchemaFields = useMemo(
    () => activeSchemaFields.filter((field) => field.source !== "system"),
    [activeSchemaFields]
  );

  const techStackField = useMemo(
    () => activeSchemaFields.find((field) => field.key === "techStack"),
    [activeSchemaFields]
  );

  const anyFieldConfig = useCallback(
    (key: string) => schemaFields.find((field) => field.key === key),
    [schemaFields]
  );

  const fieldLabel = useCallback(
    (key: string, fallback: string) => fieldConfig(key)?.label || fallback,
    [fieldConfig]
  );

  const fieldVisible = useCallback(
    (key: string) => anyFieldConfig(key)?.status !== "INACTIVE",
    [anyFieldConfig]
  );

  const fieldRequired = useCallback(
    (key: string, fallback: boolean) => fieldConfig(key)?.required ?? fallback,
    [fieldConfig]
  );

  const prospectTypeSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("prospectType"),
        catalogLookups?.prospectTypes,
        DEFAULT_PROSPECT_TYPE_OPTIONS,
        "Select type..."
      ),
    [catalogLookups, fieldConfig]
  );

  const engagementTypeSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("engagementType"),
        catalogLookups?.engagementTypes,
        DEFAULT_ENGAGEMENT_TYPE_OPTIONS,
        "Select engagement..."
      ),
    [catalogLookups, fieldConfig]
  );

  const dealStageSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("dealStage"),
        catalogLookups?.dealStages,
        [{ value: "Discovery", label: "Discovery" }]
      ),
    [catalogLookups, fieldConfig]
  );

  const statusSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(fieldConfig("status"), [], [
        { value: "Not Started", label: "Not Started" },
        { value: "In Progress", label: "In Progress" },
        { value: "Completed", label: "Completed" },
      ]),
    [fieldConfig]
  );

  const winLossSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("winOrLoss"),
        catalogLookups?.winLoss,
        DEFAULT_WIN_LOSS_OPTIONS,
        "Select outcome..."
      ),
    [catalogLookups, fieldConfig]
  );

  const currencySelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("currency"),
        catalogLookups?.currencies,
        DEFAULT_CURRENCY_OPTIONS
      ),
    [catalogLookups, fieldConfig]
  );

  const deliverablesSelectOptions = useMemo(
    () =>
      resolveFieldSelectOptions(
        fieldConfig("deliverables"),
        catalogEntriesForCategory(catalogLookups, fieldConfig("deliverables")?.lookupCategory),
        [{ value: "", label: "Select..." }]
      ),
    [catalogLookups, fieldConfig]
  );

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
    if (errors[name as keyof OpportunityFormData]) {
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
      `/prospect-groups/records?prospect=${encodeURIComponent(name)}`
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

  const setFormField = (name: keyof OpportunityFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof OpportunityFormData, string>> = {};
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

  const handleCustomFieldChange = (key: string, value: CustomFieldValue) => {
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
    if (key in formData) return String(formData[key as keyof OpportunityFormData] ?? "");
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

  return {
    isEdit,
    editId,
    canCreate,
    canUpdate,
    terminology,
    catalogLookups,
    formData,
    customFields,
    errors,
    customErrors,
    isSaving,
    loadError,
    emptyPrompt,
    setEmptyPrompt,
    prospectSuggestions,
    showSuggestions,
    setShowSuggestions,
    customSchemaFields,
    techStackField,
    fieldLabel,
    fieldVisible,
    fieldRequired,
    prospectTypeSelectOptions,
    engagementTypeSelectOptions,
    dealStageSelectOptions,
    statusSelectOptions,
    winLossSelectOptions,
    currencySelectOptions,
    deliverablesSelectOptions,
    fieldConfig,
    handleChange,
    handleProspectInput,
    selectProspectSuggestion,
    setFormField,
    handleCustomFieldChange,
    toggleOwner,
    persist,
    handleSubmit,
    navigate,
  };
}

export type UseOpportunityFormReturn = ReturnType<typeof useOpportunityForm>;

export type { TenantFieldDefinition };
