import { useParams, Link } from "react-router";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Link2, Save, X } from "lucide-react";
import { lowerFirst } from "../lib/terminology";
import {
  inputTypeForFieldType,
} from "../lib/fields";
import {
  catalogEntriesForCategory,
  resolveFieldSelectOptions,
} from "../lib/lookupOptions";
import { useAssignableUsers } from "../lib/serverState";
import { PageHeader } from "../components/shared";
import {
  useOpportunityForm,
  type TenantFieldDefinition,
} from "../hooks/useOpportunityForm";

export function OpportunityForm() {
  const params = useParams();
  const editId = params.id;
  const { users: assignableUsers } = useAssignableUsers();

  const {
    isEdit,
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
  } = useOpportunityForm(editId);

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
                    <p className="text-sm text-destructive mt-1">{errors.description}</p>
                  )}
                </div>

                {fieldVisible("deliverables") ? renderDeliverablesField() : null}

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
