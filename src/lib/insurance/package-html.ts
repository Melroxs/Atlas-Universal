// ---------------------------------------------------------------------------
// Atlas Package HTML Generator — Professional Insurance Claims Document
//
// Produces a self-contained, print-ready HTML document from a PackageModel.
// Matches the reference design: navy/blue for Claims, green for Supplements.
// All styles are inline — no external dependencies.
// ---------------------------------------------------------------------------

import type { PackageModel, FinancialCard, DamageCategory, PackageIndexEntry } from "./package-types";

// ---------------------------------------------------------------------------
// Theme colours
// ---------------------------------------------------------------------------

interface Theme {
  primary: string;       // navy or green
  primaryLight: string;  // light tint
  primaryDark: string;   // darker shade
  headerBg: string;
  headerText: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  accentBorder: string;
  accentText: string;
  cardBg: string;
  coverImageFallback: string;
}

const THEMES: Record<string, Theme> = {
  claim: {
    primary: "#1a2744",
    primaryLight: "#e8ecf4",
    primaryDark: "#0f1a2e",
    headerBg: "#1a2744",
    headerText: "#ffffff",
    tableHeaderBg: "#1a2744",
    tableHeaderText: "#ffffff",
    accentBorder: "#2563eb",
    accentText: "#1d4ed8",
    cardBg: "#f1f5f9",
    coverImageFallback: "#d4dce8",
  },
  supplement: {
    primary: "#1a3a2a",
    primaryLight: "#e6f0eb",
    primaryDark: "#0f2419",
    headerBg: "#1a3a2a",
    headerText: "#ffffff",
    tableHeaderBg: "#1a3a2a",
    tableHeaderText: "#ffffff",
    accentBorder: "#16a34a",
    accentText: "#15803d",
    cardBg: "#f0faf4",
    coverImageFallback: "#c8ddd0",
  },
};

function money(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Not Provided";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyInt(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Not Provided";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function confidencePct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ---------------------------------------------------------------------------
// Atlas SVG logo mark (simple stylised A)
// ---------------------------------------------------------------------------

function atlasLogoMark(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <path d="M20 4 L4 36 L12 36 L20 16 L28 36 L36 36 Z" fill="${color}" opacity="0.9"/>
    <path d="M14 28 L20 12 L26 28 Z" fill="white" opacity="0.3"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Common HTML blocks
// ---------------------------------------------------------------------------

function printBar(pkg: PackageModel): string {
  const theme = THEMES[pkg.packageType] ?? THEMES.claim;
  return `
<div class="no-print" style="position:sticky;top:0;z-index:100;background:${theme.primaryDark};padding:10px 24px;display:flex;justify-content:space-between;align-items:center;">
  <span style="color:#f1f5f9;font-size:13px;font-weight:600;letter-spacing:0.05em;">ATLAS — ${pkg.packageType === "supplement" ? "SUPPLEMENT PACKAGE" : "CLAIMS PACKAGE"}</span>
  <div style="display:flex;gap:8px;">
    <button onclick="window.print()" style="background:#fff;color:${theme.primary};border:none;padding:8px 18px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.03em;">PRINT / SAVE AS PDF</button>
  </div>
</div>`;
}

function pageHeader(pkg: PackageModel): string {
  const theme = THEMES[pkg.packageType] ?? THEMES.claim;
  const title = pkg.packageType === "supplement" ? "SUPPLEMENT PACKAGE" : "CLAIMS PACKAGE";
  const claimRef = pkg.coverPage.claimNumber ? `Claim #${esc(pkg.coverPage.claimNumber)}` : "";
  return `
<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 10px;margin-bottom:16px;border-bottom:2px solid ${theme.primary};">
  <div style="display:flex;align-items:center;gap:10px;">
    ${atlasLogoMark(theme.primary)}
    <div>
      <div style="font-size:14px;font-weight:800;color:${theme.primary};letter-spacing:0.1em;">ATLAS</div>
      <div style="font-size:9px;color:#6b7280;letter-spacing:0.08em;">RESTORATION &amp; CONSULTING</div>
    </div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:12px;font-weight:700;color:${theme.primary};letter-spacing:0.08em;">${title}</div>
    <div style="font-size:10px;color:#6b7280;">${claimRef}</div>
  </div>
</div>`;
}

function pageFooter(pkg: PackageModel, pageNum: number, totalPages?: number): string {
  const theme = THEMES[pkg.packageType] ?? THEMES.claim;
  return `
<div style="margin-top:32px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#9ca3af;">
  <span>Atlas Restoration &amp; Consulting, LLC | Claim ${esc(pkg.coverPage.claimNumber ?? "N/A")} | ${pkg.packageType === "supplement" ? "Supplement Package" : "Claims Package"}</span>
  <span>Page ${pageNum}${totalPages ? ` of ${totalPages}` : ""}</span>
</div>`;
}

function sectionDivider(number: string, title: string, theme: Theme): string {
  return `
<div style="page-break-before:always;padding-top:0;">
  ${"" /* Header will be injected by caller */}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">${number}</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">${title}</span>
  </div>
</div>`;
}

function coverPageSectionHeader(): string {
  return ""; // Cover page doesn't need repeating header
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generatePackageHtml(pkg: PackageModel): string {
  const theme = THEMES[pkg.packageType] ?? THEMES.claim;
  const isSupplement = pkg.packageType === "supplement";

  // ---- COVER PAGE ----
  const coverHtml = buildCoverPage(pkg, theme, isSupplement);

  // ---- EXECUTIVE SUMMARY ----
  const execSummaryHtml = `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">01</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">EXECUTIVE SUMMARY</span>
  </div>
  <div style="font-size:12px;color:#374151;line-height:1.8;">${esc(pkg.executiveSummary)}</div>
</div>`;

  // ---- CLAIM INFORMATION ----
  const claimInfoHtml = buildClaimInfoSection(pkg, theme);

  // ---- FINDINGS ----
  const findingsHtml = buildFindingsSection(pkg, theme);

  // ---- WHY ATLAS INCLUDED THIS ----
  const explanationsHtml = buildExplanationsSection(pkg, theme);

  // ---- DISCREPANCIES ----
  const discrepanciesHtml = buildDiscrepanciesSection(pkg, theme);

  // ---- EVIDENCE INDEX ----
  const evidenceHtml = buildEvidenceSection(pkg, theme);

  // ---- MISSING INFORMATION ----
  const missingHtml = buildMissingSection(pkg, theme);

  // ---- TIMELINE ----
  const timelineHtml = buildTimelineSection(pkg, theme);

  // ---- FINANCIAL RECONCILIATION ----
  const reconciliationHtml = buildReconciliationSection(pkg, theme);

  // ---- SUPPLEMENT-SPECIFIC SECTIONS ----
  const supplementHtml = isSupplement ? buildSupplementSections(pkg, theme) : "";

  // ---- DISCLAIMER ----
  const disclaimerHtml = `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">${isSupplement ? "15" : "20"}</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">QUALITY CONTROL &amp; DISCLAIMER</span>
  </div>
  <div style="padding:16px;border:1px solid #e5e7eb;border-radius:4px;background:#f9fafb;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:${theme.primary};text-transform:uppercase;letter-spacing:0.05em;">Disclaimer</p>
    <p style="margin:0;font-size:11px;color:#4b5563;line-height:1.7;">${esc(pkg.disclaimer)}</p>
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">
      <table style="width:100%;border-collapse:collapse;font-size:10px;color:#6b7280;">
        <tr><td style="padding:3px 0;">Package ID:</td><td style="padding:3px 0;font-family:monospace;">${esc(pkg._id ?? "N/A")}</td></tr>
        <tr><td style="padding:3px 0;">Generated:</td><td style="padding:3px 0;">${esc(pkg.coverPage.generatedDate)}</td></tr>
        <tr><td style="padding:3px 0;">Evidence documents:</td><td style="padding:3px 0;">${pkg.evidenceItems.length}</td></tr>
        <tr><td style="padding:3px 0;">Findings:</td><td style="padding:3px 0;">${pkg.scopeFindings.length}</td></tr>
        <tr><td style="padding:3px 0;">Missing items:</td><td style="padding:3px 0;">${pkg.missingInformation.length}</td></tr>
      </table>
    </div>
  </div>
</div>`;

  // ---- ASSEMBLE ----
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(pkg.coverPage.packageName)} — Atlas</title>
<style>
  @page { size: letter; margin: 0.6in 0.7in; }
  @media print {
    body { margin: 0; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
    .no-break { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a2e;
    background: #fff;
    line-height: 1.5;
    font-size: 11px;
  }
  table { border-collapse: collapse; }
  .section-card { border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px 14px; margin-bottom: 12px; }
</style>
</head>
<body style="margin:0;padding:0;">

${printBar(pkg)}

<div style="max-width:780px;margin:0 auto;padding:32px 36px;">

${coverHtml}

${execSummaryHtml}

${claimInfoHtml}

${findingsHtml}

${explanationsHtml}

${discrepanciesHtml}

${evidenceHtml}

${missingHtml}

${timelineHtml}

${reconciliationHtml}

${supplementHtml}

${disclaimerHtml}

</div><!-- /max-width container -->

</body>
</html>`;
}

// ===========================================================================
// COVER PAGE
// ===========================================================================

function buildCoverPage(pkg: PackageModel, theme: Theme, isSupplement: boolean): string {
  const cover = pkg.coverPage;
  const title = isSupplement ? "SUPPLEMENT PACKAGE" : "CLAIMS PACKAGE";
  const subtitle = isSupplement ? "REQUEST FOR ADDITIONAL PAYMENT" : "RESIDENTIAL PROPERTY INSURANCE CLAIM";

  // ---- Package Index table (multi-column) ----
  const indexRows = buildPackageIndexHtml(pkg.packageIndex);

  // ---- Financial Summary (claim packages) ----
  const finSummaryHtml = !isSupplement ? buildFinancialSummaryCover(pkg.financialSummary, theme) : "";

  // ---- Damage Summary (claim packages) ----
  const dmgSummaryHtml = !isSupplement ? buildDamageSummaryCover(pkg.damageSummary) : "";

  // ---- Supplement Summary (supplement packages) ----
  const suppSummaryHtml = isSupplement ? buildSupplementSummaryCover(pkg.supplementFinancialSummary, theme) : "";

  // ---- Supplement Highlights (supplement packages) ----
  const suppHighlightsHtml = isSupplement ? buildSupplementHighlightsCover(pkg.supplementHighlights, theme) : "";

  return `
<!-- ===== COVER PAGE ===== -->
<div style="padding-bottom:16px;">

  <!-- HEADER BAR -->
  <div style="background:${theme.primary};padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-radius:4px 4px 0 0;">
    <div style="display:flex;align-items:center;gap:12px;">
      ${atlasLogoMark("#ffffff")}
      <div>
        <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.12em;">ATLAS</div>
        <div style="font-size:9px;color:rgba(255,255,255,0.7);letter-spacing:0.08em;">RESTORATION &amp; CONSULTING</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.08em;">${title}</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7);letter-spacing:0.06em;">${subtitle}</div>
    </div>
  </div>

  <!-- COVER BODY: IMAGE + CLAIM INFO -->
  <div style="display:flex;gap:0;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px;overflow:hidden;">

    <!-- Left: property image or placeholder -->
    <div style="flex:0 0 45%;background:${theme.coverImageFallback};min-height:260px;display:flex;align-items:center;justify-content:center;">
      ${cover.coverImageUrl
        ? `<img src="${esc(cover.coverImageUrl)}" alt="Property" style="width:100%;height:100%;object-fit:cover;" />`
        : `<div style="text-align:center;padding:24px;">
            <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">PROPERTY IMAGE</div>
            <div style="font-size:9px;color:#9ca3af;margin-top:4px;">NOT PROVIDED</div>
          </div>`
      }
    </div>

    <!-- Right: claim info table -->
    <div style="flex:1;padding:0;">
      <table style="width:100%;border-collapse:collapse;">
        ${coverInfoRow("Claim Number:", cover.claimNumber, theme)}
        ${coverInfoRow("Policy Number:", cover.policyNumber, theme)}
        ${coverInfoRow("Insured:", cover.customer, theme)}
        ${coverInfoRow("Property Address:", cover.property, theme)}
        ${coverInfoRow("Date of Loss:", cover.dateOfLoss, theme)}
        ${coverInfoRow("Cause of Loss:", cover.causeOfLoss, theme)}
        ${isSupplement ? coverInfoRow("Date of Original Estimate:", cover.dateOfOriginalEstimate, theme) : ""}
        ${isSupplement ? coverInfoRow("Date of Supplement:", cover.dateOfSupplement, theme) : ""}
        ${isSupplement ? coverInfoRow("Supplement Package #:", cover.supplementPackageNumber, theme) : ""}
        ${!isSupplement ? coverInfoRow("Claim Package Status:", "Initial Submission", theme) : ""}
        ${coverInfoRow("Date Generated:", cover.generatedDate, theme)}
      </table>
    </div>
  </div>

  <!-- PACKAGE INDEX -->
  <div style="margin-top:16px;">
    <div style="background:${theme.primary};color:#fff;padding:8px 14px;font-size:12px;font-weight:700;letter-spacing:0.06em;">
      ${isSupplement ? "SUPPLEMENT INDEX" : "PACKAGE INDEX"}
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px;overflow:hidden;">
      ${indexRows}
    </div>
  </div>

  ${isSupplement ? suppSummaryHtml : ""}

  ${isSupplement ? suppHighlightsHtml : ""}

  ${!isSupplement ? `
  <!-- CLAIM SUMMARY -->
  <div style="margin-top:16px;">
    <div style="background:${theme.primary};color:#fff;padding:8px 14px;font-size:12px;font-weight:700;letter-spacing:0.06em;">
      CLAIM SUMMARY
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px;padding:14px;display:flex;gap:20px;">
      <div style="flex:1;">
        ${finSummaryHtml}
      </div>
      <div style="width:1px;background:#e5e7eb;"></div>
      <div style="flex:1;">
        ${dmgSummaryHtml}
      </div>
    </div>
  </div>` : ""}

  <!-- FOOTER -->
  ${pageFooter(pkg, 1)}
</div>
<!-- ===== END COVER PAGE ===== -->`;
}

// ---------------------------------------------------------------------------
// Cover helpers
// ---------------------------------------------------------------------------

function coverInfoRow(label: string, value: string | null | undefined, _theme: Theme): string {
  const display = value && value !== "Not Provided" ? esc(value) : '<span style="color:#dc2626;font-style:italic;">Not Provided</span>';
  return `<tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:7px 12px;font-size:11px;color:#6b7280;white-space:nowrap;width:42%;background:#f9fafb;font-weight:500;">${label}</td>
    <td style="padding:7px 12px;font-size:11px;color:#111827;font-weight:600;">${display}</td>
  </tr>`;
}

function buildPackageIndexHtml(index: PackageIndexEntry[]): string {
  // Split into two halves for multi-column layout
  const half = Math.ceil(index.length / 2);
  const left = index.slice(0, half);
  const right = index.slice(half);

  const headerRow = `<tr style="background:#f1f5f9;">
    <th style="padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;text-align:left;width:6%;">#</th>
    <th style="padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;text-align:left;width:60%;">Section</th>
    <th style="padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;text-align:right;width:12%;">Page</th>
    <th style="padding:5px 10px;width:2%;"></th>
    <th style="padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;text-align:left;width:6%;">#</th>
    <th style="padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;text-align:left;width:60%;">Section</th>
    <th style="padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;text-align:right;width:12%;">Page</th>
  </tr>`;

  const rows: string[] = [];
  for (let i = 0; i < half; i++) {
    const l = left[i];
    const r = right[i];
    rows.push(`<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:4px 10px;font-size:10px;color:#9ca3af;">${l.sectionNumber}</td>
      <td style="padding:4px 10px;font-size:10px;color:#111827;">${esc(l.title)}</td>
      <td style="padding:4px 10px;font-size:10px;color:#6b7280;text-align:right;">${l.page}</td>
      <td style="padding:0;width:2%;"></td>
      ${r ? `
      <td style="padding:4px 10px;font-size:10px;color:#9ca3af;">${r.sectionNumber}</td>
      <td style="padding:4px 10px;font-size:10px;color:#111827;">${esc(r.title)}</td>
      <td style="padding:4px 10px;font-size:10px;color:#6b7280;text-align:right;">${r.page}</td>
      ` : '<td></td><td></td><td></td>'}
    </tr>`);
  }

  return `<table style="width:100%;border-collapse:collapse;">${headerRow}${rows.join("")}</table>`;
}

function buildFinancialSummaryCover(cards: FinancialCard[], theme: Theme): string {
  return `
<div style="margin-bottom:8px;">
  <div style="font-size:10px;font-weight:700;color:${theme.primary};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Financial Summary</div>
  <table style="width:100%;border-collapse:collapse;">
    ${cards.map(c => `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:5px 10px;font-size:10px;color:#374151;">${esc(c.label)}</td>
      <td style="padding:5px 10px;font-size:11px;color:${c.emphasized ? "#dc2626" : "#111827"};font-weight:${c.emphasized ? "800" : "600"};text-align:right;font-family:monospace;">${esc(c.formatted)}</td>
    </tr>`).join("")}
  </table>
</div>`;
}

function buildDamageSummaryCover(categories: DamageCategory[]): string {
  const iconMap: Record<string, string> = {
    "roof": "🏠",
    "siding": "🏗️",
    "interior": "💧",
    "gutters": "🔧",
    "windows": "🪟",
    "doors": "🚪",
    "attic": "📐",
  };

  return `
<div>
  <div style="font-size:10px;font-weight:700;color:#1a2744;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Damage Summary</div>
  <table style="width:100%;border-collapse:collapse;">
    ${categories.map(c => {
      const key = c.label.toLowerCase();
      const icon = Object.entries(iconMap).find(([k]) => key.includes(k))?.[1] ?? "📋";
      return `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:5px 10px;font-size:10px;color:#374151;">${icon} ${esc(c.label)}</td>
        <td style="padding:5px 10px;font-size:10px;font-weight:700;color:${c.present ? "#16a34a" : "#9ca3af"};text-align:right;">${c.present ? "Yes" : "No"}</td>
      </tr>`;
    }).join("")}
  </table>
</div>`;
}

function buildSupplementSummaryCover(cards: FinancialCard[], theme: Theme): string {
  return `
<div style="margin-top:16px;">
  <div style="background:${theme.primary};color:#fff;padding:8px 14px;font-size:12px;font-weight:700;letter-spacing:0.06em;">
    SUPPLEMENT SUMMARY
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px;padding:14px;">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${cards.map(c => `
      <div style="flex:1;min-width:140px;border:1px solid ${c.emphasized ? theme.accentBorder : "#e5e7eb"};border-radius:4px;padding:10px 12px;background:${c.emphasized ? theme.primaryLight : "#fff"};">
        <div style="font-size:8px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">${esc(c.label)}</div>
        <div style="font-size:16px;font-weight:800;color:${c.emphasized ? theme.accentText : "#111827"};font-family:monospace;">${esc(c.formatted)}</div>
      </div>`).join("")}
    </div>
  </div>
</div>`;
}

function buildSupplementHighlightsCover(highlights: import("./package-types").SupplementHighlight[], theme: Theme): string {
  return `
<div style="margin-top:16px;display:flex;gap:16px;">
  <div style="flex:1;">
    <div style="background:${theme.primary};color:#fff;padding:8px 14px;font-size:12px;font-weight:700;letter-spacing:0.06em;">
      KEY SUPPLEMENT HIGHLIGHTS
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px;padding:12px;">
      ${highlights.length > 0
        ? highlights.map(h => `
        <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
          <span style="color:${theme.accentText};font-weight:700;font-size:11px;">✓</span>
          <span style="font-size:10px;color:#374151;line-height:1.5;">${esc(h.text)}</span>
        </div>`).join("")
        : '<div style="font-size:10px;color:#9ca3af;font-style:italic;">No highlights identified</div>'
      }
    </div>
  </div>
</div>`;
}

// ===========================================================================
// CLAIM INFORMATION SECTION
// ===========================================================================

function buildClaimInfoSection(pkg: PackageModel, theme: Theme): string {
  const rows = pkg.claimInformation.map(f => {
    const stateColor = f.state === "verified" || f.state === "extracted"
      ? "#16a34a"
      : f.state === "missing"
        ? "#dc2626"
        : "#d97706";
    const stateLabel = f.state === "verified" || f.state === "extracted"
      ? ""
      : ` <span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:8px;font-weight:700;background:${f.state === "missing" ? "#fef2f2" : "#fffbeb"};color:${stateColor};text-transform:uppercase;letter-spacing:0.04em;">${f.state}</span>`;
    return `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:6px 12px;font-size:10px;color:#6b7280;width:180px;background:#f9fafb;font-weight:500;">${esc(f.label)}</td>
      <td style="padding:6px 12px;font-size:10px;color:#111827;font-weight:600;">${f.value ? esc(f.value) : '<span style="color:#dc2626;font-style:italic;">Not Provided</span>'}${stateLabel}</td>
    </tr>`;
  }).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">02</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">CLAIM INFORMATION</span>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">
    ${rows}
  </table>
</div>`;
}

// ===========================================================================
// FINDINGS SECTION
// ===========================================================================

function buildFindingsSection(pkg: PackageModel, theme: Theme): string {
  if (pkg.scopeFindings.length === 0) return "";

  const findingsHtml = pkg.scopeFindings.map((f, i) => `
  <div class="no-break" style="border:1px solid #e5e7eb;border-radius:4px;padding:12px 14px;margin-bottom:12px;background:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
      <div style="flex:1;">
        <div style="font-size:9px;color:${theme.primary};font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Finding ${i + 1}</div>
        <div style="font-size:12px;font-weight:700;color:#111827;">${esc(f.title)}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:700;background:#fffbeb;color:#92400e;">Potential</span>
        <span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:700;background:${theme.primaryLight};color:${theme.primary};">${confidencePct(f.confidence)}</span>
      </div>
    </div>
    <p style="margin:0 0 8px;font-size:10px;color:#4b5563;line-height:1.6;">${esc(f.description)}</p>
    ${f.estimatedAmount != null ? `<p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#16a34a;">Estimated impact: ${money(f.estimatedAmount)}</p>` : ""}
    ${f.evidence.length > 0 ? `
    <div style="margin:6px 0;">
      <div style="font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;">Supporting Evidence</div>
      ${f.evidence.map(e => `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
        <span style="color:${theme.primary};font-size:9px;">📎</span>
        <span style="font-size:10px;color:#374151;">${esc(e)}</span>
      </div>`).join("")}
    </div>` : ""}
    <p style="margin:4px 0 0;font-size:9px;color:#9ca3af;font-style:italic;">${esc(f.limitation)}</p>
    <div style="margin-top:6px;padding:6px 10px;background:#f5f3ff;border-radius:3px;">
      <span style="font-size:9px;font-weight:700;color:#6366f1;">Recommended action:</span>
      <span style="font-size:10px;color:#4b5563;"> ${esc(f.recommendedNextStep)}</span>
    </div>
  </div>`).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">03</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">SCOPE FINDINGS</span>
  </div>
  <p style="font-size:10px;color:#6b7280;margin:0 0 16px;">Atlas identified ${pkg.scopeFindings.length} potential finding${pkg.scopeFindings.length === 1 ? "" : "s"} from the available evidence. All findings are potential — they require verification before action.</p>
  ${findingsHtml}
</div>`;
}

// ===========================================================================
// EXPLANATIONS SECTION — "Why Atlas Included This"
// ===========================================================================

function buildExplanationsSection(pkg: PackageModel, theme: Theme): string {
  if (pkg.explanations.length === 0) return "";

  const items = pkg.explanations.map(x => `
  <div class="no-break" style="border-left:3px solid ${theme.accentBorder};padding:10px 14px;margin-bottom:10px;background:${theme.primaryLight};">
    <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:4px;">${esc(x.finding)}</div>
    <div style="font-size:10px;color:#4b5563;line-height:1.6;">${esc(x.whyItMatters)}</div>
    ${x.evidence.length > 0 ? `<div style="margin-top:4px;font-size:9px;color:#6b7280;">Evidence: ${x.evidence.map(e => esc(e)).join("; ")}</div>` : ""}
  </div>`).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">04</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">WHY ATLAS INCLUDED THIS</span>
  </div>
  <p style="font-size:10px;color:#6b7280;margin:0 0 16px;">Each finding is grounded in specific evidence. Atlas explains what it found, which documents support it, and why it matters.</p>
  ${items}
</div>`;
}

// ===========================================================================
// DISCREPANCIES SECTION
// ===========================================================================

function buildDiscrepanciesSection(pkg: PackageModel, theme: Theme): string {
  if (pkg.discrepancies.length === 0) return "";

  const rows = pkg.discrepancies.map(d => `
  <div class="no-break" style="border:1px solid #fde68a;border-radius:4px;padding:10px 14px;margin-bottom:10px;background:#fffbeb;">
    <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px;">${esc(d.field)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <tr>
        <td style="padding:3px 8px;color:#374151;font-weight:600;width:40%;">${esc(d.valueA)}</td>
        <td style="padding:3px 8px;color:#9ca3af;">${esc(d.sourceA)}</td>
      </tr>
      <tr>
        <td style="padding:3px 8px;color:#374151;font-weight:600;">${esc(d.valueB)}</td>
        <td style="padding:3px 8px;color:#9ca3af;">${esc(d.sourceB)}</td>
      </tr>
    </table>
    <div style="margin-top:4px;font-size:9px;color:#b45309;font-weight:600;">${esc(d.difference)}</div>
  </div>`).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">05</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">DISCREPANCIES</span>
  </div>
  <p style="font-size:10px;color:#6b7280;margin:0 0 16px;">Atlas found the following discrepancies between sources. Both values are preserved — no silent resolution.</p>
  ${rows}
</div>`;
}

// ===========================================================================
// EVIDENCE INDEX SECTION
// ===========================================================================

function buildEvidenceSection(pkg: PackageModel, theme: Theme): string {
  const headerRow = `<tr style="background:${theme.tableHeaderBg};">
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:5%;">#</th>
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:30%;">Document</th>
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:15%;">Type</th>
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:15%;">Date</th>
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:35%;">Relevance</th>
  </tr>`;

  const rows = pkg.evidenceItems.map((e, i) => `
  <tr style="border-bottom:1px solid #f0f0f0;${i % 2 === 0 ? "" : "background:#f9fafb;"}">
    <td style="padding:6px 10px;font-size:10px;color:#9ca3af;">${i + 1}</td>
    <td style="padding:6px 10px;font-size:10px;color:#111827;font-weight:600;">${esc(e.title)}</td>
    <td style="padding:6px 10px;font-size:10px;color:#6b7280;">${esc(e.classification ?? "—")}</td>
    <td style="padding:6px 10px;font-size:10px;color:#6b7280;">${esc(e.date ?? "—")}</td>
    <td style="padding:6px 10px;font-size:10px;color:#6b7280;">${esc(e.relevance)}</td>
  </tr>`).join("");

  const content = pkg.evidenceItems.length > 0
    ? `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">${headerRow}${rows}</table>`
    : '<p style="font-size:10px;color:#9ca3af;font-style:italic;">No evidence documents are currently linked to this claim.</p>';

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">06</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">PHOTO / VIDEO EVIDENCE INDEX</span>
  </div>
  ${content}
</div>`;
}

// ===========================================================================
// MISSING INFORMATION SECTION
// ===========================================================================

function buildMissingSection(pkg: PackageModel, theme: Theme): string {
  if (pkg.missingInformation.length === 0) return "";

  const items = pkg.missingInformation.map(m => `
  <div class="no-break" style="border:1px solid #fecaca;border-radius:4px;padding:8px 12px;margin-bottom:8px;background:#fef2f2;">
    <div style="font-size:10px;font-weight:700;color:#991b1b;">${esc(m.category)} — Missing</div>
    <div style="font-size:10px;color:#7f1d1d;margin-top:2px;">${esc(m.description)}</div>
    <div style="font-size:9px;color:#9ca3af;font-style:italic;margin-top:2px;">Why needed: ${esc(m.whyNeeded)}</div>
  </div>`).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">07</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">MISSING INFORMATION</span>
  </div>
  <p style="font-size:10px;color:#6b7280;margin:0 0 12px;">The following required information was not found in the available records. This does not block package generation.</p>
  ${items}
</div>`;
}

// ===========================================================================
// TIMELINE SECTION
// ===========================================================================

function buildTimelineSection(pkg: PackageModel, theme: Theme): string {
  if (pkg.claimTimeline.length === 0) return "";

  const headerRow = `<tr style="background:${theme.tableHeaderBg};">
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:20%;">Date</th>
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:50%;">Event</th>
    <th style="padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;width:30%;">Source</th>
  </tr>`;

  const rows = pkg.claimTimeline.map((t, i) => `
  <tr style="border-bottom:1px solid #f0f0f0;${i % 2 === 0 ? "" : "background:#f9fafb;"}">
    <td style="padding:6px 10px;font-size:10px;color:#6b7280;white-space:nowrap;">${esc(t.date)}</td>
    <td style="padding:6px 10px;font-size:10px;color:#111827;font-weight:500;">${esc(t.event)}</td>
    <td style="padding:6px 10px;font-size:10px;color:#9ca3af;">${esc(t.source)}</td>
  </tr>`).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">08</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">CLAIM TIMELINE</span>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">${headerRow}${rows}</table>
</div>`;
}

// ===========================================================================
// FINANCIAL RECONCILIATION SECTION
// ===========================================================================

function buildReconciliationSection(pkg: PackageModel, theme: Theme): string {
  const cards = pkg.financialSummary;
  if (cards.length === 0 && pkg.reconciliationNotes.length === 0) return "";

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">09</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">FINANCIAL RECONCILIATION</span>
  </div>
  ${cards.length > 0 ? `
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:16px;">
    <thead>
      <tr style="background:${theme.tableHeaderBg};">
        <th style="padding:6px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:left;">Item</th>
        <th style="padding:6px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${theme.tableHeaderText};text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${cards.map((c, i) => `<tr style="border-bottom:1px solid #f0f0f0;${i % 2 === 0 ? "" : "background:#f9fafb;"}">
        <td style="padding:6px 12px;font-size:10px;color:#374151;">${esc(c.label)}</td>
        <td style="padding:6px 12px;font-size:11px;color:${c.emphasized ? "#dc2626" : "#111827"};font-weight:${c.emphasized ? "800" : "600"};text-align:right;font-family:monospace;">${esc(c.formatted)}</td>
      </tr>`).join("")}
    </tbody>
  </table>` : ""}
  ${pkg.reconciliationNotes.length > 0 ? `
  <div style="margin-top:12px;">
    <div style="font-size:10px;font-weight:700;color:${theme.primary};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Notes</div>
    ${pkg.reconciliationNotes.map(n => `<div style="font-size:10px;color:#4b5563;margin-bottom:4px;padding-left:12px;border-left:2px solid ${theme.accentBorder};">${esc(n)}</div>`).join("")}
  </div>` : ""}
</div>`;
}

// ===========================================================================
// SUPPLEMENT-SPECIFIC SECTIONS (inside the document body)
// ===========================================================================

function buildSupplementSections(pkg: PackageModel, theme: Theme): string {
  const scopeItems = pkg.requestedAdditionalScope.map(s => `
  <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
    <span style="color:${theme.accentText};font-weight:700;font-size:10px;">•</span>
    <span style="font-size:10px;color:#374151;line-height:1.5;">${esc(s)}</span>
  </div>`).join("");

  return `
<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">10</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">REQUESTED ADDITIONAL SCOPE</span>
  </div>
  ${scopeItems || '<p style="font-size:10px;color:#9ca3af;font-style:italic;">No additional scope items identified.</p>'}
</div>

<div style="page-break-before:always;">
  ${pageHeader(pkg)}
  <div style="background:${theme.primary};color:#fff;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;">11</span>
    <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;">SUPPLEMENT JUSTIFICATION</span>
  </div>
  <p style="font-size:11px;color:#374151;line-height:1.7;">${esc(pkg.whyThisScopeIsRequired || "This determination is based on the evidence analysis. See findings below.")}</p>
</div>`;
}
