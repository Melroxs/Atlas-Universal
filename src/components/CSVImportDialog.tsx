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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  type CSVRow,
  type ColumnMapping,
  type MappedLead,
  type ValidationResult,
  parseCSV,
  suggestMappings,
  mapRowsToLeads,
  validateLeads,
  deduplicateLeads,
  ATLAS_FIELDS,
  generateBatchId,
} from "@/lib/crm/csv-import";

interface CSVImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: (leads: MappedLead[], batchId: string) => void;
  existingLeads?: Array<{ id: string; contact_email?: string; company_name: string }>;
}

type Step = "upload" | "map" | "validate" | "import" | "done";

export function CSVImportDialog({
  open,
  onClose,
  onImportComplete,
  existingLeads = [],
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
  }, []);

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
        setMappings(suggestMappings(csvHeaders));
        setStep("map");
        toast.success(`Parsed ${rows.length} rows from ${file.name}`);
      };
      reader.readAsText(file);

      // Reset input so same file can be re-selected
      e.target.value = "";
    },
    [],
  );

  const handleMappingChange = (csvColumn: string, atlasField: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.csvColumn === csvColumn ? { ...m, atlasField } : m,
      ),
    );
  };

  const handleValidate = () => {
    const leads = mapRowsToLeads(rawRows, mappings);
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
                  Supports .csv files up to 10MB
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
                <p className="font-medium mb-1">Supported columns:</p>
                <p>
                  first_name, last_name, email (required), phone, company_name
                  (required), website, city, state, service_area, industry,
                  job_title, source, notes
                </p>
              </div>
            </div>
          )}

          {step === "map" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Map your CSV columns to Atlas CRM fields. Required fields are
                marked with *.
              </p>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {mappings.map((m) => (
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
                    </select>
                  </div>
                ))}
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
