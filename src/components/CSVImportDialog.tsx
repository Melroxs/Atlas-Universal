import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  type CSVRow,
  type ColumnMapping,
  type MappedLead,
  type ValidationResult,
  type CustomFieldDefinition,
  parseCSV,
  suggestMappings,
  mapRowsToLeads,
  validateLeads,
  deduplicateLeads,
  ATLAS_FIELDS,
  CUSTOM_FIELD_TYPES,
  generateFieldKey,
  ensureUniqueKey,
  generateBatchId,
} from "@/lib/crm/csv-import";

interface CSVImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: (leads: MappedLead[], batchId: string) => void;
  existingLeads?: Array<{ id: string; contact_email?: string; company_name: string }>;
  /** Existing custom fields from the CRM — used for auto-matching */
  customFields?: CustomFieldDefinition[];
  /** Callback to create a new custom field — receives the field definition and returns the created field */
  onCreateCustomField?: (field: {
    name: string;
    key: string;
    field_type: string;
    entity_type: string;
  }) => Promise<CustomFieldDefinition>;
}

type Step = "upload" | "map" | "validate" | "import" | "done";

export function CSVImportDialog({
  open,
  onClose,
  onImportComplete,
  existingLeads = [],
  customFields = [],
  onCreateCustomField,
}: CSVImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [rawRows, setRawRows] = useState<CSVRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [uniqueLeads, setUniqueLeads] = useState<MappedLead[]>([]);
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [batchId, setBatchId] = useState("");
  const [allCustomFields, setAllCustomFields] = useState<CustomFieldDefinition[]>(customFields);

  // Custom field creation modal state
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [fieldModalCsvColumn, setFieldModalCsvColumn] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [creatingField, setCreatingField] = useState(false);
  const [fieldExampleValues, setFieldExampleValues] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("upload");
    setRawRows([]);
    setHeaders([]);
    setMappings([]);
    setValidation(null);
    setUniqueLeads([]);
    setImporting(false);
    setImportCount(0);
    setBatchId("");
    setAllCustomFields(customFields);
    setShowFieldModal(false);
    setNewFieldName("");
    setNewFieldKey("");
    setNewFieldType("text");
    setFieldExampleValues([]);
  }, [customFields]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith(".csv")) {
        toast.error("Please select a CSV file");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast.error("File too large (max 10MB)");
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) {
          toast.error("No data rows found in CSV");
          return;
        }

        setRawRows(rows);
        const csvHeaders = Object.keys(rows[0]);
        setHeaders(csvHeaders);
        setMappings(suggestMappings(csvHeaders, allCustomFields));
        setStep("map");
        toast.success(`Parsed ${rows.length} rows from ${file.name}`);
      };
      reader.readAsText(file);

      // Reset input so same file can be re-selected
      e.target.value = "";
    },
    [allCustomFields],
  );

  const handleMappingChange = (csvColumn: string, atlasField: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.csvColumn === csvColumn
          ? { csvColumn, atlasField, customFieldId: atlasField === "__custom__" ? undefined : undefined, isCustom: atlasField === "__custom__" }
          : m,
      ),
    );
  };

  const handleMappingToCustom = (csvColumn: string, customFieldId: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.csvColumn === csvColumn
          ? { ...m, csvColumn, atlasField: "__custom__", customFieldId, isCustom: true }
          : m,
      ),
    );
  };

  const openCreateFieldModal = (csvColumn: string) => {
    setFieldModalCsvColumn(csvColumn);
    setNewFieldName(csvColumn);
    setNewFieldKey(generateFieldKey(csvColumn));
    setNewFieldType("text");

    // Gather example values from this CSV column
    const examples = rawRows
      .slice(0, 5)
      .map((r) => (r[csvColumn] ?? "").trim())
      .filter(Boolean);
    setFieldExampleValues(examples);
    setShowFieldModal(true);
  };

  const handleCreateField = async () => {
    if (!newFieldName.trim()) {
      toast.error("Field name is required");
      return;
    }

    const key = ensureUniqueKey(
      newFieldKey || generateFieldKey(newFieldName),
      new Set(allCustomFields.map((f) => f.key)),
    );

    setCreatingField(true);
    try {
      if (onCreateCustomField) {
        const created = await onCreateCustomField({
          name: newFieldName.trim(),
          key,
          field_type: newFieldType,
          entity_type: "lead",
        });
        // Add to local state
        setAllCustomFields((prev) => [...prev, created]);
        // Auto-map the CSV column to the new field
        handleMappingToCustom(fieldModalCsvColumn, created.id);
        toast.success(`Created field "${created.name}"`);
      } else {
        // No callback — create locally only (for preview / preview-only flow)
        const localField: CustomFieldDefinition = {
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          tenant_id: "local",
          name: newFieldName.trim(),
          key,
          field_type: newFieldType,
          entity_type: "lead",
          created_at: new Date().toISOString(),
        };
        setAllCustomFields((prev) => [...prev, localField]);
        handleMappingToCustom(fieldModalCsvColumn, localField.id);
        toast.success(`Created field "${localField.name}" (local)`);
      }
      setShowFieldModal(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create field");
    } finally {
      setCreatingField(false);
    }
  };

  const handleValidate = () => {
    const leads = mapRowsToLeads(rawRows, mappings, allCustomFields);
    const result = validateLeads(leads);

    // Deduplicate
    const { unique, duplicates } = deduplicateLeads(result.valid, existingLeads);

    result.duplicates = duplicates;
    result.stats.validCount = unique.length;
    result.stats.duplicateCount = duplicates.length;

    setValidation(result);
    setUniqueLeads(unique);
    setStep("validate");
  };

  const handleImport = async () => {
    setImporting(true);
    const id = generateBatchId();
    setBatchId(id);

    // Simulate import delay for UX (actual import happens via onImportComplete callback)
    await new Promise((r) => setTimeout(r, 500));

    setImportCount(uniqueLeads.length);
    setStep("done");
    setImporting(false);
    onImportComplete(uniqueLeads, id);
    toast.success(`Imported ${uniqueLeads.length} leads`);
  };

  const getFieldTypeLabel = (key: string) =>
    CUSTOM_FIELD_TYPES.find((t) => t.key === key)?.label ?? key;

  // Count mapping summary
  const mappedCount = mappings.filter((m) => m.atlasField !== "__ignore__").length;
  const newFieldCount = mappings.filter((m) => m.isCustom).length;
  const ignoredCount = mappings.filter((m) => m.atlasField === "__ignore__").length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Leads from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file, map columns, validate, and import leads into your
            CRM.
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {(["upload", "map", "validate", "import", "done"] as Step[]).map(
            (s, i) => (
              <div key={s} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" />}
                <span
                  className={
                    step === s
                      ? "font-medium text-foreground"
                      : ["upload", "map", "validate", "import", "done"].indexOf(step) > i
                        ? "text-teal-600"
                        : ""
                  }
                >
                  {s === "upload"
                    ? "Upload"
                    : s === "map"
                      ? "Map"
                      : s === "validate"
                        ? "Validate"
                        : s === "import"
                          ? "Import"
                          : "Done"}
                </span>
              </div>
            ),
          )}
        </div>

        {/* Step Content */}
        <div className="py-2">
          {step === "upload" && (
            <div className="space-y-4">
              <div
                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/60 p-8 transition-colors hover:border-teal-400/40 hover:bg-muted/20 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  Click to upload CSV
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Supports .csv files up to 10MB — any columns accepted
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                <p className="font-medium mb-1">Core CRM fields (auto-mapped):</p>
                <p>
                  first_name, last_name, email (required), phone, company_name
                  (required), website, city, state, service_area, industry,
                  job_title, source, notes
                </p>
                <p className="mt-2 font-medium">Any other columns?</p>
                <p>Create new CRM fields directly from the mapping screen.</p>
              </div>
            </div>
          )}

          {step === "map" && (
            <div className="space-y-4">
              {/* Mapping summary */}
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="text-green-600">
                  {mappedCount} mapped
                </Badge>
                {newFieldCount > 0 && (
                  <Badge variant="outline" className="text-blue-600">
                    {newFieldCount} new fields
                  </Badge>
                )}
                {ignoredCount > 0 && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {ignoredCount} ignored
                  </Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Map your CSV columns to Atlas CRM fields. Required fields are
                marked with *. Click <strong>+ Create</strong> to add new CRM fields.
              </p>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {mappings.map((m) => {
                  const existingCf = m.customFieldId
                    ? allCustomFields.find((cf) => cf.id === m.customFieldId)
                    : null;
                  return (
                    <div
                      key={m.csvColumn}
                      className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">
                          {m.csvColumn}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">
                          CSV column
                        </p>
                      </div>
                      <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
                      <div className="flex items-center gap-1.5 shrink-0">
                        {m.isCustom && existingCf ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400">
                              {existingCf.name}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              New
                            </Badge>
                          </div>
                        ) : m.isCustom && m.customFieldId ? (
                          <Badge variant="outline" className="text-[10px]">
                            Custom
                          </Badge>
                        ) : (
                          <select
                            value={m.atlasField}
                            onChange={(e) =>
                              handleMappingChange(m.csvColumn, e.target.value)
                            }
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs min-w-[160px]"
                          >
                            <option value="__ignore__">— Ignore —</option>
                            {ATLAS_FIELDS.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                                {f.required ? " *" : ""}
                              </option>
                            ))}
                            {allCustomFields.map((cf) => (
                              <option key={`cf_${cf.id}`} value={`__custom__:${cf.id}`}>
                                {cf.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {m.atlasField === "__ignore__" && (
                          <button
                            type="button"
                            onClick={() => openCreateFieldModal(m.csvColumn)}
                            className="flex items-center gap-1 h-8 rounded-md border border-dashed border-teal-400/40 px-2 text-[11px] text-teal-600 dark:text-teal-300 hover:bg-teal-500/5 transition-colors"
                            title="Create a new CRM field from this CSV column"
                          >
                            <Plus className="size-3" />
                            Create
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep("upload")}>
                  Back
                </Button>
                <Button size="sm" onClick={handleValidate}>
                  Validate & Preview
                </Button>
              </div>
            </div>
          )}

          {step === "validate" && validation && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                <StatCard
                  label="Total Rows"
                  value={validation.stats.totalRows}
                  color="text-foreground"
                />
                <StatCard
                  label="Valid"
                  value={validation.stats.validCount}
                  color="text-green-600"
                />
                <StatCard
                  label="Invalid"
                  value={validation.stats.invalidCount}
                  color="text-red-600"
                />
                <StatCard
                  label="Duplicates"
                  value={validation.stats.duplicateCount}
                  color="text-yellow-600"
                />
              </div>

              {/* Invalid Rows */}
              {validation.invalid.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-red-600">
                    Invalid Rows ({validation.invalid.length})
                  </p>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto">
                    {validation.invalid.map((inv) => (
                      <div
                        key={inv.rowIndex}
                        className="flex items-start gap-2 rounded bg-red-500/5 p-2 text-xs"
                      >
                        <AlertCircle className="size-3 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-muted-foreground">
                            Row {inv.rowIndex + 1}:
                          </span>{" "}
                          {inv.errors.join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Duplicates */}
              {validation.duplicates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-yellow-600">
                    Duplicates ({validation.duplicates.length})
                  </p>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto">
                    {validation.duplicates.map((dup) => (
                      <div
                        key={dup.rowIndex}
                        className="flex items-start gap-2 rounded bg-yellow-500/5 p-2 text-xs"
                      >
                        <AlertCircle className="size-3 text-yellow-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-muted-foreground">
                            Row {dup.rowIndex + 1}:
                          </span>{" "}
                          {dup.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview */}
              {uniqueLeads.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-green-600">
                    Ready to Import ({uniqueLeads.length} leads)
                  </p>
                  <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border/60">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/60 text-left text-muted-foreground">
                          <th className="p-2">Company</th>
                          <th className="p-2">Contact</th>
                          <th className="p-2">Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uniqueLeads.slice(0, 20).map((lead) => (
                          <tr
                            key={lead._rowIndex}
                            className="border-b border-border/30"
                          >
                            <td className="p-2">{lead.companyName}</td>
                            <td className="p-2">{lead.fullName || "—"}</td>
                            <td className="p-2">{lead.email}</td>
                          </tr>
                        ))}
                        {uniqueLeads.length > 20 && (
                          <tr>
                            <td
                              colSpan={3}
                              className="p-2 text-center text-muted-foreground"
                            >
                              ...and {uniqueLeads.length - 20} more
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep("map")}>
                  Back
                </Button>
                <Button
                  size="sm"
                  disabled={uniqueLeads.length === 0 || importing}
                  onClick={handleImport}
                >
                  {importing ? "Importing..." : `Import ${uniqueLeads.length} Leads`}
                </Button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center py-8">
              <div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
                <Check className="size-6 text-green-600" />
              </div>
              <p className="mt-4 text-sm font-medium">
                Successfully imported {importCount} leads
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Batch ID: {batchId}
              </p>
              <Button className="mt-4" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Create Custom Field Modal */}
      <Dialog open={showFieldModal} onOpenChange={setShowFieldModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create CRM Field</DialogTitle>
            <DialogDescription>
              Create a new CRM field and map it to the CSV column{" "}
              <strong>{fieldModalCsvColumn}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Field Name <span className="text-red-500">*</span>
              </Label>
              <Input
                value={newFieldName}
                onChange={(e) => {
                  setNewFieldName(e.target.value);
                  setNewFieldKey(generateFieldKey(e.target.value));
                }}
                placeholder="e.g. Insurance Focus"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Field Key</Label>
              <Input
                value={newFieldKey}
                onChange={(e) => setNewFieldKey(e.target.value)}
                placeholder="auto-generated"
                className="h-9 font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Auto-generated from the name. You can edit it.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Field Type</Label>
              <select
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {fieldExampleValues.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Example values from CSV</Label>
                <div className="rounded-lg bg-muted/30 p-2">
                  {fieldExampleValues.map((v, i) => (
                    <p key={i} className="text-xs text-muted-foreground truncate">
                      {v}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFieldModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateField} disabled={creatingField || !newFieldName.trim()}>
              {creatingField ? "Creating..." : "Create Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
