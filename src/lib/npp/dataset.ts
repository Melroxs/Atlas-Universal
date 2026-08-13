// ---------------------------------------------------------------------------
// NPP Roofing & Restoration — synthetic demo dataset (Phase 15).
//
// This is the canonical demonstration scenario used by the live E2E. It is
// entirely SYNTHETIC and mirrors the spec:
//   113 files · 48 PDFs · 8 spreadsheets/CSV · 6 Word docs · 41 images ·
//   10 email/text/Markdown · exact duplicate groups · redundant copies ·
//   formal claim references · 1 potential claim cluster · contradictions ·
//   missing evidence · recovery-opportunity content.
//
// Storyline: Robert Mitchell / Robert J. Mitchell / Bob Mitchell,
// 1427 Cypress Ridge Drive, Lakeland FL 33813, Gulf Atlantic Property
// Insurance, policy GAP-HO-884217, claim GAP-26-51847. The archive is messy
// on purpose: inconsistent filenames, aliases, near-version copies,
// contradictory dates and financial values, incomplete and missing evidence.
// ---------------------------------------------------------------------------

import { makePdf } from "./pdf";
import JSZip from "jszip";

export interface NppFile {
  /** Path inside the archive. */
  path: string;
  /** UTF-8 text content, or pre-built binary bytes. */
  content: string | Uint8Array;
}

/**
 * Distinct image bytes for a seed: the tiny valid 1px base plus a unique
 * trailing marker. Every real photo/scan in the dataset must be unique so
 * checksum dedupe only fires on the INTENTIONAL duplicate groups — never on
 * placeholder pixels. (Trailing data after PNG IEND / JPEG EOI is tolerated
 * by browsers and decoders; Atlas only uses magic bytes + extension.)
 */
function uniqueImage(seed: string, kind: "png" | "jpg"): Uint8Array {
  const base = kind === "png" ? PNG_1PX : JPG_1PX;
  const tag = new TextEncoder().encode(`\n--atlas-img-${seed}--\n`);
  const out = new Uint8Array(base.length + tag.length);
  out.set(base, 0);
  out.set(tag, base.length);
  return out;
}

/** 1x1 transparent PNG (tiny, valid). */
const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00,
  0x01, 0x5c, 0x9c, 0x6e, 0x67, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

/** 1x1 JPEG (tiny, valid enough for the format contract). */
const JPG_1PX = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08,
  0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a,
  0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d,
  0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22,
  0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34,
  0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0,
  0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
  0x00, 0x1a, 0x00, 0x00, 0x02, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
  0xc4, 0x00, 0x1b, 0x01, 0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
  0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0x92, 0x63, 0xef,
  0xf8, 0x23, 0x55, 0x40, 0xbf, 0xff, 0xd9,
]);

/** Build a minimal .docx (zip with word/document.xml) that mammoth can read. */
async function makeDocx(title: string, paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const body = [title, ...paragraphs]
    .map(
      (p) =>
        `<w:p><w:r><w:t xml:space="preserve">${p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</w:t></w:r></w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return blob;
}

// ---------------------------------------------------------------------------
// Core claim content (GAP-26-51847 — Robert Mitchell).
// ---------------------------------------------------------------------------

const CUSTOMER = "Robert J. Mitchell (also known as Robert Mitchell / Bob Mitchell)";
const PROPERTY = "1427 Cypress Ridge Drive, Lakeland FL 33813";
const CARRIER = "Gulf Atlantic Property Insurance";
const POLICY = "GAP-HO-884217";
const CLAIM = "GAP-26-51847";
const LOSS_DATE_ONE = "May 18, 2026"; // contradiction: other docs say May 19
const LOSS_DATE_TWO = "May 19, 2026";

function fnol(): string {
  return [
    `FIRST NOTICE OF LOSS — Claim ${CLAIM}`,
    `Insured: ${CUSTOMER}`,
    `Property: ${PROPERTY}`,
    `Policy: ${POLICY}`,
    `Carrier: ${CARRIER}`,
    `Date of loss: ${LOSS_DATE_ONE}`,
    `Cause: Wind and hail`,
    `Reported by: homeowner`,
    `Initial notes: roof shingles displaced, gutter separation, water entry in the kitchen.`,
    `Adjuster: R. Delgado`,
    `Status: Open`,
  ].join("\n");
}

function estimate(): string {
  return [
    `ESTIMATE — Claim ${CLAIM}`,
    `Prepared by NPP Roofing & Restoration`,
    `Roof area measured: 32.4 SQ`, // contradiction: xactimate says 28.7 SQ
    `Line items:`,
    `- Tear off and replace asphalt shingles (32.4 SQ)`,
    `- Replace roof decking (14 sheets)`,
    `- Replace drip edge (142 linear ft)`, // recovery opportunity
    `- Replace ridge vent (60 linear ft)`, // recovery opportunity
    `- Pipe flashing (4 units)`, // recovery opportunity
    `- Gutters and downspouts (120 linear ft)`,
    `- Kitchen interior water mitigation`,
    `- Debris disposal and dumpster`, // recovery opportunity
    `- Roof permit and inspection fee`, // recovery opportunity
    `Total estimate: $24,500.00`,
    `Deductible: $2,500.00`,
    `Measurement/tear-off evidence on file: measurementsheet.xlsx`, // recovery opportunity
  ].join("\n");
}

function xactimate(): string {
  return [
    `XACTIMATE SUMMARY — Claim ${CLAIM}`,
    `Roof area: 28.7 SQ`, // contradiction vs 32.4 SQ in estimate
    `Roofing: $18,420.00`, // contradiction: NPP ledger says $17,920.00
    `Exterior (gutters, drip edge, ridge vent): $3,600.00`,
    `Interior mitigation: $2,480.00`,
    `Subtotal: $24,500.00`,
    `Carrier-approved estimate total: $24,500.00`,
    `Note: line items for drip edge and ridge vent were included in the carrier estimate.`,
  ].join("\n");
}

function invoice(): string {
  return [
    `INVOICE — Claim ${CLAIM}`,
    `NPP Roofing & Restoration · Invoice #10477`,
    `Line items:`,
    `- Roof replacement labor and materials`,
    `- Gutters and downspouts`,
    `- Kitchen water mitigation`,
    `- Drip edge and ridge vent (as itemized in the estimate)`,
    `Invoice total: $28,400.00`,
    `Terms: Net 30`,
    `NPP ledger entry: $17,920.00 carrier payment applied; open balance $10,480.00`, // contradiction
  ].join("\n");
}

function payment(): string {
  return [
    `CARRIER PAYMENT — Claim ${CLAIM}`,
    `Payer: ${CARRIER}`,
    `Payment reference: PAY-60811`,
    `Payment date: June 2, 2026`,
    `Payment amount: $17,920.00`, // contradiction: carrier estimate says $18,420
    `Check note: First payment — depreciation withheld, subject to final scope.`,
  ].join("\n");
}

function supplement(): string {
  return [
    `SUPPLEMENT REQUEST #1 — Claim ${CLAIM}`,
    `Submitted by NPP Roofing & Restoration`,
    `Omitted scope discovered during demolition:`,
    `- Additional roof decking (6 sheets)`,
    `- Fascia and soffit repair`,
    `- Attic insulation replacement`,
    `- Permit extension fee`,
    `Requested additional amount: $6,750.00`,
    `Supporting evidence: inspection report, photo log, measurements.`,
    `Note: the claim was reported as closed by the carrier on June 15, 2026,`, // contradiction: closed claim vs later supplement
    `but this supplement was submitted June 20, 2026.`,
  ].join("\n");
}

function correspondence(): string {
  return [
    `EMAIL — ${CARRIER} → NPP Roofing & Restoration`,
    `Subject: Re: Supplement ${CLAIM}`,
    `Date: June 24, 2026`,
    `We are reviewing supplement #1. We require the signed homeowner authorization,`,
    `the final measurement report, and proof of completion before we can issue a`,
    `decision. Note our records show the claim closed on June 15 — please confirm`,
    `why work continued after closure.`,
    `— Claims Department`,
  ].join("\n");
}

function inspection(): string {
  return [
    `INSPECTION REPORT — Claim ${CLAIM}`,
    `Inspector: NPP field team`,
    `Date: May 25, 2026`,
    `Findings:`,
    `- Hail damage confirmed on south-facing slope`,
    `- Decking water staining (6 sheets)`,
    `- Missing drip edge on garage section`,
    `- Ridge vent damaged at two locations`,
    `- Pipe flashings cracked (4 units)`,
    `Photos: IMG_001–IMG_014`,
    `Note: attic access was not available at inspection time.`, // missing evidence
  ].join("\n");
}

function scope(): string {
  return [
    `SCOPE OF WORK — Claim ${CLAIM}`,
    `Documented scope (estimate + supplement):`,
    `1. Roof shingle replacement (32.4 SQ)`,
    `2. Roof decking replacement (14 sheets + 6 sheets supplement)`,
    `3. Drip edge (142 linear ft)`,
    `4. Ridge vent (60 linear ft)`,
    `5. Pipe flashing (4 units)`,
    `6. Gutters and downspouts (120 linear ft)`,
    `7. Kitchen mitigation`,
    `8. Attic insulation replacement (supplement)`,
    `9. Fascia and soffit repair (supplement)`,
    `10. Permit + disposal`,
    `Total documented scope: $31,250.00`,
  ].join("\n");
}

function policy(): string {
  return [
    `POLICY — ${CARRIER}`,
    `Policy number: ${POLICY}`,
    `Named insured: Robert Mitchell`,
    `Property: ${PROPERTY}`,
    `Dwelling limit: $350,000.00`,
    `Deductible: $2,500.00`,
    `Wind/hail endorsement: Replacement Cost`,
    `Endorsement RDE-14 (roof deductible elimination) listed on declarations,`, // missing evidence: endorsement doc not on file
    `but the endorsement document itself is NOT in the supplied company data.`,
  ].join("\n");
}

function customer(): string {
  return [
    `CUSTOMER RECORD`,
    `Name: Robert Mitchell`,
    `Aliases on file: Robert J. Mitchell, Bob Mitchell`,
    `Address: ${PROPERTY}`,
    `Phone: (863) 555-0148`,
    `Email: bob.mitchell@example.com`,
    `Signed authorization: NOT on file`, // missing evidence
    `Note: homeowner requested work begin before authorization was returned.`,
  ].join("\n");
}

function photoLog(): string {
  return [
    `PHOTO LOG — Claim ${CLAIM}`,
    `IMG_001 — south roof slope, hail impact`,
    `IMG_002 — displaced shingles, garage`,
    `IMG_005 — kitchen ceiling water stain`,
    `IMG_009 — decking rot, bedroom two`,
    `IMG_012 — gutter separation, rear`,
    `IMG_014 — ridge vent damage`,
  ].join("\n");
}

function notes(): string {
  return [
    `FIELD NOTES — ${CLAIM} (partial)`,
    `Talked to the homeowner about the kitchen. Adjuster still needs to come back.`,
    `The attic was not checked at inspection. Homeowner mentioned a prior claim on`,
    `this property around 2019 — old claim file not included in this package.`, // old claim reference
  ].join("\n");
}

function measurementCsv(): string {
  return [
    "Section,SQ,Notes",
    "South slope,14.2,Hail damage confirmed",
    "North slope,12.1,",
    "Garage,6.1,Drip edge missing",
    "Total,32.4,Matches NPP estimate",
  ].join("\n");
}

function ledgerCsv(): string {
  return [
    "Claim,Item,Amount,Source",
    `${CLAIM},Estimate approved,24500,Carrier xactimate`,
    `${CLAIM},Carrier payment applied,17920,NPP ledger`,
    `${CLAIM},Invoiced,28400,NPP invoice`,
    `${CLAIM},Open balance,10480,NPP ledger`,
  ].join("\n");
}

function oldClaim(): string {
  return [
    `OLD/PRIOR CLAIM FILE — Robert Mitchell`,
    `Prior claim number: CL-2019-48211`, // keeps old claim distinct (2019)
    `Carrier: ${CARRIER}`,
    `Date of loss: September 2019`,
    `Cause: hurricane`,
    `Status: CLOSED`,
    `Note: This is the OLD claim. It is NOT ${CLAIM}. Do not merge them.`,
  ].join("\n");
}

const CUSTOMERS = [
  "Harborview Property Group",
  "Lakeside Villas HOA",
  "Cypress Point Apartments",
  "Magnolia Townhomes",
  "Sunset Plaza Retail",
  "Twin Palms Community",
  "Oakwood Condos",
  "Bayshore Commercial",
  "Fern Grove Estates",
  "Winter Haven Church",
];

// ---------------------------------------------------------------------------
// Dataset builder
// ---------------------------------------------------------------------------

export async function buildNppDataset(): Promise<NppFile[]> {
  const files: NppFile[] = [];
  const push = (path: string, content: string | Uint8Array) => files.push({ path, content });

  // --- Core claim (GAP-26-51847): PDFs -------------------------------------------------
  const claimPdfs: Array<[string, string]> = [
    ["FNOL_Report.pdf", fnol()],
    ["Estimate_NPP.pdf", estimate()],
    ["Xactimate_Summary.pdf", xactimate()],
    ["Invoice_10477.pdf", invoice()],
    ["Carrier_Payment_60811.pdf", payment()],
    ["Supplement_Request_1.pdf", supplement()],
    ["Inspection_Report.pdf", inspection()],
    ["Scope_of_Work.pdf", scope()],
    ["Policy_GAP-HO-884217.pdf", policy()],
    ["Customer_Record.pdf", customer()],
    ["Carrier_Correspondence_June24.pdf", correspondence()],
    ["Field_Notes.pdf", notes()],
  ];
  for (const [name, body] of claimPdfs) {
    push(`Claims/GAP-26-51847/${name}`, makePdf(`Claim ${CLAIM} — ${name.replace(/_/g, " ").replace(".pdf", "")}`, body));
  }

  // Core claim: images, spreadsheets, word, eml, text/md.
  for (let i = 1; i <= 10; i++) {
    push(`Claims/GAP-26-51847/Photos/IMG_0${String(i).padStart(2, "0")}.jpg`, uniqueImage(`claim-photo-${i}`, "jpg"));
  }
  push(`Claims/GAP-26-51847/measurements.csv`, measurementCsv());
  push(`Claims/GAP-26-51847/ledger.csv`, ledgerCsv());
  push(`Claims/GAP-26-51847/Authorization_Letter.docx`, await makeDocx("Homeowner authorization letter", [
    `I authorize NPP Roofing & Restoration to perform the work described in the estimate for claim ${CLAIM}.`,
    `Signed: [signature pending — on file at office]`, // missing evidence
  ]));
  push(`Claims/GAP-26-51847/carrier_initial.eml`, [
    "From: claims@gulfatlantic.example",
    "To: office@npproofing.example",
    "Subject: Loss assigned — GAP-26-51847",
    "Date: May 20, 2026",
    "",
    `Claim ${CLAIM} for Robert Mitchell at 1427 Cypress Ridge Drive has been assigned.`,
    "Please schedule the inspection.",
  ].join("\r\n"));
  push(`Claims/GAP-26-51847/notes.md`, notes());

  // Exact duplicate group A: 3 byte-identical copies of the estimate (same
  // title + body as Estimate_NPP.pdf) — the archive engine dedupes by
  // checksum, so these surface as exact duplicates with provenance.
  push(`Duplicate-Group-A/estimate_copy1.pdf`, makePdf("Claim GAP-26-51847 — Estimate NPP", estimate()));
  push(`Duplicate-Group-A/estimate_copy2.pdf`, makePdf("Claim GAP-26-51847 — Estimate NPP", estimate()));
  // Redundant exact duplicate of the estimate.
  push(`Claims/GAP-26-51847/Estimate_NPP_duplicate.pdf`, makePdf("Claim GAP-26-51847 — Estimate NPP", estimate()));

  // --- Old/prior claim ------------------------------------------------------------------
  push(`OldClaims/CL-2019-48211/prior_claim_summary.pdf`, makePdf("Prior claim summary", oldClaim()));
  push(`OldClaims/CL-2019-48211/prior_payment.pdf`, makePdf("Prior claim payment", oldClaim()));
  for (let i = 1; i <= 6; i++) {
    push(`OldClaims/CL-2019-48211/old_photo_${i}.jpg`, uniqueImage(`old-photo-${i}`, "jpg"));
  }
  push(`OldClaims/CL-2019-48211/old_notes.txt`, oldClaim());

  // Exact duplicate group C: 2 byte-identical copies of the FNOL report.
  // (Added before the PDF filler count so the totals stay exactly 48.)
  push(`Duplicate-Group-C/FNOL_dup.pdf`, makePdf("Claim GAP-26-51847 — FNOL Report", fnol()));
  push(`Duplicate-Group-C/FNOL_dup_again.pdf`, makePdf("Claim GAP-26-51847 — FNOL Report", fnol()));

  // --- Generic company files ------------------------------------------------------------
  let genericPdf = 0;
  for (const c of CUSTOMERS) {
    for (const kind of ["Invoice", "Statement"]) {
      if (genericPdf >= 15) break;
      const body = `Invoice/statement — ${c}\nAmount: $${(1 + genericPdf * 137) % 9000 + 500}.00\nReference: INV-2026-${1000 + genericPdf}`;
      push(`Company/${c.replace(/\s+/g, "_")}/${kind}_${genericPdf}.pdf`, makePdf(`${kind} — ${c}`, body));
      genericPdf++;
    }
  }
  // Fill remaining PDF count (48 total): generic letters/correspondence.
  const fillerPdfTarget = 48 - files.filter((f) => f.content instanceof Uint8Array && f.path.endsWith(".pdf")).length;
  for (let i = 0; i < fillerPdfTarget; i++) {
    push(`Letters/company_letter_${String(i).padStart(2, "0")}.pdf`, makePdf(`Company letter ${i}`, `General correspondence from NPP Roofing & Restoration, item ${i}.`));
  }

  // Spreadsheets/CSV (8 total).
  push(`Company/vendors.xlsx`, await makeXlsx("Vendors", [["Vendor", "Category", "Active"], ["ABC Supply", "Roofing materials", "yes"], ["Gulf Supply", "Gutters", "yes"]]));
  push(`Company/customer_list.csv`, "Customer,Address,Phone\nRobert Mitchell,1427 Cypress Ridge Drive,(863) 555-0148\n");
  push(`Claims/GAP-26-51847/payments_summary.xlsx`, await makeXlsx("Payments", [["Claim", "Amount"], [CLAIM, 17920]]));
  push(`OldClaims/CL-2019-48211/prior_ledger.xlsx`, await makeXlsx("Prior", [["Claim", "Paid"], ["CL-2019-48211", 9800]]));

  // Word docs (6 total): 3 core + 3 generic.
  push(`Company/SOP_Estimate.docx`, await makeDocx("SOP — Estimating", ["All estimates must include tear-off, decking, drip edge, ridge vent, flashing, permit and disposal line items.", "Measurements require a signed measurement sheet."]));
  push(`Company/SOP_Supplement.docx`, await makeDocx("SOP — Supplements", ["Supplements require the homeowner authorization and inspection photos before submission."]));
  push(`Company/Welcome_Letter.docx`, await makeDocx("Welcome letter", ["Thank you for choosing NPP Roofing & Restoration."]));
  push(`Company/SOP_Inspection.docx`, await makeDocx("SOP — Inspections", ["Inspection photos must be numbered IMG_### and logged against the claim before the report is submitted."]));
  push(`Company/Office_Memo.docx`, await makeDocx("Office memo", ["Reminder: every supplement request requires the signed homeowner authorization before submission."]));

  // Images (41 total): 10 claim + 6 old claim + 2 duplicate-group + 23 generic.
  for (let i = 0; i < 23; i++) {
    push(`Photos/job_${String(i).padStart(2, "0")}.png`, uniqueImage(`job-${i}`, "png"));
  }

  // Email/text/Markdown (10 total): 3 eml + 4 txt + 3 md.
  push(`Correspondence/estimate_transmittal.eml`, [
    "From: office@npproofing.example",
    "To: r.delgado@gulfatlantic.example",
    "Subject: Estimate for GAP-26-51847",
    "Date: May 28, 2026",
    "",
    "Attached is the estimate for the Robert Mitchell claim. Total $24,500.00.",
  ].join("\r\n"));
  push(`Correspondence/invoice_transmittal.eml`, [
    "From: office@npproofing.example",
    "To: claims@gulfatlantic.example",
    "Subject: Invoice 10477 — GAP-26-51847",
    "Date: July 1, 2026",
    "",
    "Invoice for the completed roof work is attached. Total $28,400.00.",
  ].join("\r\n"));
  push(`Notes/supplement_notes.txt`, "Supplement #1 still pending — missing signed authorization and measurement report.\n");
  push(`Notes/payment_notes.txt`, "Carrier payment applied 6/2/2026 for $17,920.00. Balance per NPP ledger: $10,480.00.\n");
  push(`Notes/recovery_notes.txt`, "Potential recovery items for the Mitchell claim: drip edge, ridge vent, decking, pipe flashing, permit, disposal, measurement/tear-off evidence.\n");
  push(`README.md`, "# NPP Roofing & Restoration — company data\nThis is a synthetic demo dataset. All names and figures are fictional.\n");
  push(`Company/overview.md`, "NPP Roofing & Restoration performs storm restoration, estimates, and supplements for homeowners in central Florida.\n");

  // --- Duplicate groups (exact duplicates at different paths) ----------------------------
  push(`Duplicate-Group-B/ledger_copy.xlsx`, await makeXlsx("Payments", [["Claim", "Amount"], [CLAIM, 17920]]));
  push(`Duplicate-Group-B/ledger_copy_2.csv`, ledgerCsv());
  push(`Duplicate-Group-D/photo_dup.jpg`, JPG_1PX);
  push(`Duplicate-Group-D/photo_dup_copy.jpg`, JPG_1PX);

  return files;
}

async function makeXlsx(sheetName: string, rows: Array<Array<string | number>>): Promise<Uint8Array> {
  // Dynamic import keeps the xlsx dependency out of the pure builder's
  // static graph (it's only needed to BUILD fixtures, not to run the app).
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

/** Build the full 113-file archive ZIP in memory (jszip). */
export async function buildNppZip(): Promise<{ bytes: Uint8Array; files: NppFile[] }> {
  const files = await buildNppDataset();
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.path, f.content as string | Uint8Array);
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, files };
}
