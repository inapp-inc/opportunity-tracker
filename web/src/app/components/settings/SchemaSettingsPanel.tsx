import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Badge } from "../ui/Badge";
import { Modal } from "../ui/Modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/Table";
import { apiFetch } from "../../lib/api";
import type { TenantFieldDefinition } from "../../lib/opportunity";
import { useTerminology } from "../../lib/terminology";
import { FIELD_TYPE_OPTIONS } from "../../lib/fields";
import { notifyTenantLookupsUpdated, useTenantSchema } from "../../lib/serverState";
import { useCanManageTenantSettings } from "../../lib/roles";
import type { LookupCategory } from "../../pages/settings/types";

type SchemaEditState = {
  label: string;
  fieldType: TenantFieldDefinition["fieldType"];
  options: string;
  lookupCategory: string;
  required: boolean;
  showInTable: boolean;
  status: string;
  sortOrder: string;
};

export function SchemaSettingsPanel() {
  const canManageSettings = useCanManageTenantSettings();
  const isAdmin = canManageSettings;
  const terminology = useTerminology();
  const {
    fields: schemaFields,
    loading: schemaLoading,
    reload: loadSchema,
  } = useTenantSchema();

  const [lookupCategories, setLookupCategories] = useState<LookupCategory[]>([]);
  const [newField, setNewField] = useState({
    label: "",
    key: "",
    fieldType: "text" as TenantFieldDefinition["fieldType"],
    options: "",
    lookupCategory: "",
    required: false,
    showInTable: false,
  });
  const [editingSchemaField, setEditingSchemaField] = useState<TenantFieldDefinition | null>(null);
  const [schemaEdit, setSchemaEdit] = useState<SchemaEditState>({
    label: "",
    fieldType: "text",
    options: "",
    lookupCategory: "",
    required: false,
    showInTable: false,
    status: "ACTIVE",
    sortOrder: "0",
  });

  const loadLookupCategories = useCallback(async () => {
    if (!canManageSettings) return;
    try {
      const res = await apiFetch<{ categories?: LookupCategory[] }>("/settings/lookups");
      setLookupCategories(res.categories || []);
    } catch {
      setLookupCategories([]);
    }
  }, [canManageSettings]);

  useEffect(() => {
    void loadLookupCategories();
  }, [loadLookupCategories]);

  const patchSchemaField = async (
    id: string,
    patch: Partial<TenantFieldDefinition>
  ) => {
    try {
      await apiFetch(`/settings/schema/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadSchema();
      await notifyTenantLookupsUpdated();
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update field");
      return false;
    }
  };

  const addSchemaField = async () => {
    if (!newField.label.trim()) return;
    try {
      await apiFetch("/settings/schema", {
        method: "POST",
        body: JSON.stringify(newField),
      });
      setNewField({
        label: "",
        key: "",
        fieldType: "text",
        options: "",
        lookupCategory: "",
        required: false,
        showInTable: false,
      });
      await loadSchema();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create field");
    }
  };

  const deleteSchemaField = async (id: string, label: string, source: string) => {
    const message =
      source === "system"
        ? `Hide "${label}" from forms, tables, and layouts? Existing ${terminology.recordSingular.toLowerCase()} data is kept; you can restore the field later by setting its status to Active.`
        : `Remove "${label}" from future forms and views? Existing values stay in stored ${terminology.recordSingular.toLowerCase()} data. You can restore it from this schema list.`;
    if (!confirm(message)) return;
    try {
      await apiFetch(`/settings/schema/${id}`, { method: "DELETE" });
      await loadSchema();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove field");
    }
  };

  const startEditSchemaField = (field: TenantFieldDefinition) => {
    setEditingSchemaField(field);
    setSchemaEdit({
      label: field.label,
      fieldType: field.fieldType,
      options: (field.options || []).join(", "),
      lookupCategory: field.lookupCategory || "",
      required: field.required,
      showInTable: field.showInTable,
      status: field.status || "ACTIVE",
      sortOrder: String(field.sortOrder ?? 0),
    });
  };

  const saveSchemaField = async () => {
    if (!editingSchemaField) return;
    const isChoiceField = ["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(
      schemaEdit.fieldType
    );
    const saved = await patchSchemaField(editingSchemaField.id, {
      label: schemaEdit.label.trim(),
      fieldType: schemaEdit.fieldType,
      options: isChoiceField
        ? schemaEdit.options
            .split(",")
            .map((option) => option.trim())
            .filter(Boolean)
        : [],
      lookupCategory: isChoiceField ? schemaEdit.lookupCategory : "",
      required: schemaEdit.required,
      showInTable: schemaEdit.showInTable,
      status: schemaEdit.status,
      sortOrder: Number(schemaEdit.sortOrder || 0),
    });
    if (saved) setEditingSchemaField(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{terminology.recordSingular} Schema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Review built-in fields and add any number of custom fields that appear on this
            workspace&apos;s {terminology.recordSingular.toLowerCase()} forms, detail views,
            and optionally the {terminology.recordSingular.toLowerCase()} table.
          </p>

          {isAdmin ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <Input
                label="Field label"
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                placeholder="Customer segment"
              />
              <Input
                label="Field key (optional)"
                value={newField.key}
                onChange={(e) => setNewField({ ...newField, key: e.target.value })}
                placeholder="customer_segment"
              />
              <Select
                label="Field type"
                value={newField.fieldType}
                onChange={(e) =>
                  setNewField({
                    ...newField,
                    fieldType: e.target.value as TenantFieldDefinition["fieldType"],
                  })
                }
                options={FIELD_TYPE_OPTIONS}
              />
              {["select", "multi_select"].includes(newField.fieldType) ? (
                <Input
                  label="Options (comma-separated)"
                  value={newField.options}
                  onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                  placeholder="Strategic, Enterprise, SMB"
                />
              ) : null}
              {["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(
                newField.fieldType
              ) ? (
                <Select
                  label="Lookup source"
                  value={newField.lookupCategory}
                  onChange={(e) => setNewField({ ...newField, lookupCategory: e.target.value })}
                  options={[
                    { value: "", label: "Inline options" },
                    ...lookupCategories.map((category) => ({
                      value: category.category,
                      label: category.label,
                    })),
                  ]}
                />
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newField.showInTable}
                  onChange={(e) => setNewField({ ...newField, showInTable: e.target.checked })}
                />
                Show in table
              </label>
              <Button type="button" onClick={() => void addSchemaField()}>
                <Plus className="w-4 h-4" />
                Add Field
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only administrators can change workspace schema fields.
            </p>
          )}

          {schemaLoading ? (
            <p className="text-sm text-muted-foreground">Loading schema…</p>
          ) : schemaFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No configurable fields yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Lookup</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schemaFields.map((field) => (
                  <TableRow
                    key={field.id}
                    className={field.status === "INACTIVE" ? "opacity-60" : undefined}
                  >
                    <TableCell>
                      {isAdmin ? (
                        <Input
                          defaultValue={field.label}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (value && value !== field.label) {
                              void patchSchemaField(field.id, { label: value });
                            }
                          }}
                        />
                      ) : (
                        field.label
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{field.key}</code>
                    </TableCell>
                    <TableCell>
                      {field.source === "system" ? "Built-in" : "Custom"}
                      {field.status === "INACTIVE" ? (
                        <Badge variant="secondary" className="ml-2">
                          Hidden
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{field.fieldType}</TableCell>
                    <TableCell>
                      {isAdmin &&
                      ["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(
                        field.fieldType
                      ) ? (
                        <Select
                          value={field.lookupCategory || ""}
                          onChange={(e) =>
                            void patchSchemaField(field.id, {
                              lookupCategory: e.target.value,
                            } as Partial<TenantFieldDefinition>)
                          }
                          options={[
                            { value: "", label: "Inline" },
                            ...lookupCategories.map((category) => ({
                              value: category.category,
                              label: category.label,
                            })),
                          ]}
                        />
                      ) : field.lookupCategory ? (
                        field.lookupCategory
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) =>
                            void patchSchemaField(field.id, { required: e.target.checked })
                          }
                        />
                      ) : field.required ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <input
                          type="checkbox"
                          checked={field.showInTable}
                          onChange={(e) =>
                            void patchSchemaField(field.id, { showInTable: e.target.checked })
                          }
                        />
                      ) : field.showInTable ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => startEditSchemaField(field)}
                            title="Edit field"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() =>
                              void deleteSchemaField(field.id, field.label, field.source || "custom")
                            }
                            title={
                              field.status === "INACTIVE"
                                ? "Field is already hidden"
                                : field.source === "system"
                                  ? "Hide field"
                                  : "Remove field"
                            }
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={Boolean(editingSchemaField)}
        onClose={() => setEditingSchemaField(null)}
        title={editingSchemaField ? `Edit ${editingSchemaField.label}` : "Edit Field"}
        size="lg"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditingSchemaField(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveSchemaField()}>
              Save Field
            </Button>
          </>
        }
      >
        {editingSchemaField ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Field label"
                value={schemaEdit.label}
                onChange={(e) => setSchemaEdit({ ...schemaEdit, label: e.target.value })}
              />
              <Input
                label="Field key"
                value={editingSchemaField.key}
                disabled
                helperText="Keys are stable so existing saved values keep mapping correctly."
              />
              <Select
                label="Field type"
                value={schemaEdit.fieldType}
                onChange={(e) =>
                  setSchemaEdit({
                    ...schemaEdit,
                    fieldType: e.target.value as TenantFieldDefinition["fieldType"],
                  })
                }
                options={[
                  ...(FIELD_TYPE_OPTIONS.some((option) => option.value === schemaEdit.fieldType)
                    ? []
                    : [{ value: schemaEdit.fieldType, label: schemaEdit.fieldType }]),
                  ...FIELD_TYPE_OPTIONS,
                ]}
              />
              <Input
                label="Sort order"
                type="number"
                value={schemaEdit.sortOrder}
                onChange={(e) => setSchemaEdit({ ...schemaEdit, sortOrder: e.target.value })}
              />
              {["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(
                schemaEdit.fieldType
              ) ? (
                <>
                  <Select
                    label="Lookup source"
                    value={schemaEdit.lookupCategory}
                    onChange={(e) =>
                      setSchemaEdit({ ...schemaEdit, lookupCategory: e.target.value })
                    }
                    options={[
                      { value: "", label: "Inline options" },
                      ...lookupCategories.map((category) => ({
                        value: category.category,
                        label: category.label,
                      })),
                    ]}
                  />
                  <Input
                    label="Inline options"
                    value={schemaEdit.options}
                    disabled={Boolean(schemaEdit.lookupCategory)}
                    onChange={(e) => setSchemaEdit({ ...schemaEdit, options: e.target.value })}
                    helperText={
                      schemaEdit.lookupCategory
                        ? "Options come from the selected lookup source."
                        : "Comma-separated values. Required for choice fields without a lookup source."
                    }
                  />
                </>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={schemaEdit.required}
                  onChange={(e) => setSchemaEdit({ ...schemaEdit, required: e.target.checked })}
                />
                Required
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={schemaEdit.showInTable}
                  onChange={(e) => setSchemaEdit({ ...schemaEdit, showInTable: e.target.checked })}
                />
                Show in table
              </label>
              <Select
                label="Status"
                value={schemaEdit.status}
                onChange={(e) => setSchemaEdit({ ...schemaEdit, status: e.target.value })}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Hidden" },
                ]}
              />
            </div>

            {editingSchemaField.source === "system" ? (
              <p className="text-sm text-muted-foreground">
                Built-in fields keep their key for existing data. Set status to Hidden to remove this
                field from forms, tables, and layouts without deleting stored values.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
