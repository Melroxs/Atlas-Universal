// ---------------------------------------------------------------------------
// Atlas Package HTML Generator
//
// Produces a self-contained, print-ready HTML document from a PackageModel.
// The HTML is styled to look like a professional claims submission document.
// No external dependencies — all styles are inline.
// ---------------------------------------------------------------------------

import type { PackageModel } from "./package-types";

// ---------------------------------------------------------------------------
// State badge colors (Tailwind-safe classes won't work in print; use inline)
// ---------------------------------------------------------------------------

const STATE_COLORS: Record<string, { bg: string; fg: string }> = {
  verified: { bg: "#d1fae5", fg: "#065f46" },
  extracted: { bg: "#dbeafe", fg: "#1e40af" },
  derived: { bg: "#dbeafe", fg: "#1e40af" },
  inferred: { bg: "#ede9fe", fg: "#5b21b6" },
  missing: { bg: "#fee2e2", fg: "#991b1b" },
  conflicted: { bg: "#fef3c7", fg: "#92400e" },
  needs_review: { bg: "#fef3c7", fg: "#92400e" },
};

function stateBadge(state: string): string {
  const c = STATE_COLORS[state] ?? { bg: "#f3f4f6", fg: "#374151" };
  return `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;background:${c.bg};color:${c.fg};">${state.replace(/_/g, " ")}</span>`;
}

function money(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function confidencePct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ---------------------------------------------------------------------------
// HTML generator
// ---------------------------------------------------------------------------

export function generatePackageHtml(pkg: PackageModel): string {
  const isSupplement = pkg.packageType === "supplement";

  // Build claim info table rows
  const claimInfoRows = pkg.claimInformation
    .map(
      (f) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:200px;">${f.label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:500;">
          ${f.value ?? '<span style="color:#dc2626;font-style:italic;">Not recorded</span>'}
          ${f.state !== "verified" && f.state !== "extracted" ? " " + stateBadge(f.state) : ""}
        </td>
      </tr>`,
    )
    .join("");

  // Evidence index rows
  const evidenceRows = pkg.evidenceItems
    .map(
      (e, i) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">${i + 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#111827;font-weight:500;">${e.title}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${e.classification ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${e.date ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${e.relevance}</td>
      </tr>`,
    )
    .join("");

  // Findings rows
  const findingsHtml = pkg.scopeFindings
    .map(
      (f) => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#fffbeb;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <h4 style="margin:0;font-size:13px;font-weight:600;color:#111827;">${f.title}</h4>
          <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;background:#fef3c7;color:#92400e;">Potential · ${confidencePct(f.confidence)}</span>
        </div>
        <p style="margin:8px 0 0;font-size:12px;color:#4b5563;line-height:1.6;">${f.description}</p>
        ${f.estimatedAmount ? `<p style="margin:4px 0 0;font-size:12px;font-weight:600;color:#059669;">Estimated amount: ${money(f.estimatedAmount)}</p>` : ""}
        ${f.evidence.length > 0 ? `<ul style="margin:8px 0 0;padding-left:20px;font-size:12px;color:#4b5563;">${f.evidence.map((e) => `<li style="margin:2px 0;">${e}</li>`).join("")}</ul>` : ""}
        <p style="margin:8px 0 0;font-size:11px;color:#9ca3af;font-style:italic;">${f.limitation}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#6366f1;">Next step: ${f.recommendedNextStep}</p>
      </div>`,
    )
    .join("");

  // Missing information
  const missingHtml = pkg.missingInformation
    .map(
      (m) => `
      <div style="border:1px solid #fecaca;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#fef2f2;">
        <p style="margin:0;font-size:12px;font-weight:600;color:#991b1b;">${m.category} — Missing</p>
        <p style="margin:4px 0 0;font-size:12px;color:#7f1d1d;">${m.description}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#9ca3af;font-style:italic;">Why needed: ${m.whyNeeded}</p>
      </div>`,
    )
    .join("");

  // Explanations
  const explanationsHtml = pkg.explanations
    .map(
      (x) => `
      <div style="border-left:3px solid #818cf8;padding:10px 14px;margin-bottom:10px;background:#f5f3ff;">
        <p style="margin:0;font-size:12px;font-weight:600;color:#111827;">${x.finding}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#4b5563;line-height:1.6;">${x.whyItMatters}</p>
        ${x.evidence.length > 0 ? `<p style="margin:4px 0 0;font-size:11px;color:#6b7280;">Evidence: ${x.evidence.join("; ")}</p>` : ""}
      </div>`,
    )
    .join("");

  // Discrepancies
  const discrepanciesHtml = pkg.discrepancies
    .map(
      (d) => `
      <div style="border:1px solid #fde68a;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#fffbeb;">
        <p style="margin:0;font-size:12px;font-weight:600;color:#92400e;">${d.field}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#4b5563;">
          <strong>${d.valueA}</strong> (${d.sourceA}) vs <strong>${d.valueB}</strong> (${d.sourceB})
        </p>
        <p style="margin:2px 0 0;font-size:11px;color:#b45309;">${d.difference}</p>
      </div>`,
    )
    .join("");

  // Timeline
  const timelineHtml = pkg.claimTimeline
    .map(
      (t) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;white-space:nowrap;">${t.date}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#111827;">${t.event}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">${t.source}</td>
      </tr>`,
    )
    .join("");

  // Reconciliation
  const reconciliationHtml = pkg.reconciliationNotes
    .map((n) => `<li style="margin:4px 0;font-size:12px;color:#4b5563;">${n}</li>`)
    .join("");

  // Requested scope (supplement)
  const requestedScopeHtml = isSupplement
    ? `
    <div style="page-break-inside:avoid;">
      <h3 style="font-size:16px;font-weight:700;color:#111827;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
        Requested Additional Scope
      </h3>
      ${pkg.requestedAdditionalScope.length > 0
        ? `<ul style="padding-left:20px;">${pkg.requestedAdditionalScope.map((s) => `<li style="margin:4px 0;font-size:13px;color:#374151;line-height:1.6;">${s}</li>`).join("")}</ul>`
        : '<p style="font-size:13px;color:#6b7280;font-style:italic;">No additional scope items identified.</p>'
      }
      <h3 style="font-size:16px;font-weight:700;color:#111827;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
        Why This Scope Is Required
      </h3>
      <p style="font-size:13px;color:#374151;line-height:1.7;">${pkg.whyThisScopeIsRequired || "This determination is based on the evidence analysis. See findings below."}</p>
    </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pkg.coverPage.packageName}</title>
<style>
  @media print {
    body { margin: 0; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
  }
</style>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;background:#fff;line-height:1.6;">

<!-- Print / Download bar -->
<div class="no-print" style="position:sticky;top:0;z-index:100;background:#1e293b;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;">
  <span style="color:#f1f5f9;font-size:13px;font-weight:600;">${pkg.coverPage.packageName}</span>
  <div style="display:flex;gap:8px;">
    <button onclick="window.print()" style="background:#0d9488;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Print / Save as PDF</button>
  </div>
</div>

<!-- Cover Page -->
<div style="max-width:800px;margin:0 auto;padding:48px 40px;">
  <div style="text-align:center;margin-bottom:40px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#6b7280;margin-bottom:8px;">Atlas Insurance Intelligence</div>
    <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0 0 4px;letter-spacing:-0.02em;">
      ${isSupplement ? "Supplement Package" : "Claim Package"}
    </h1>
    <div style="font-size:14px;color:#6b7280;">
      Generated ${pkg.coverPage.generatedDate}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin:0 auto 32px;max-width:500px;">
    <tbody>
      ${pkg.coverPage.claimNumber ? `<tr><td style="padding:8px 16px;font-size:12px;color:#6b7280;text-align:right;border-bottom:1px solid #e5e7eb;">Claim Number</td><td style="padding:8px 16px;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb;">${pkg.coverPage.claimNumber}</td></tr>` : ""}
      ${pkg.coverPage.customer ? `<tr><td style="padding:8px 16px;font-size:12px;color:#6b7280;text-align:right;border-bottom:1px solid #e5e7eb;">Insured</td><td style="padding:8px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${pkg.coverPage.customer}</td></tr>` : ""}
      ${pkg.coverPage.property ? `<tr><td style="padding:8px 16px;font-size:12px;color:#6b7280;text-align:right;border-bottom:1px solid #e5e7eb;">Property</td><td style="padding:8px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${pkg.coverPage.property}</td></tr>` : ""}
      ${pkg.coverPage.carrier ? `<tr><td style="padding:8px 16px;font-size:12px;color:#6b7280;text-align:right;border-bottom:1px solid #e5e7eb;">Carrier</td><td style="padding:8px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${pkg.coverPage.carrier}</td></tr>` : ""}
      ${pkg.coverPage.policyNumber ? `<tr><td style="padding:8px 16px;font-size:12px;color:#6b7280;text-align:right;border-bottom:1px solid #e5e7eb;">Policy</td><td style="padding:8px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${pkg.coverPage.policyNumber}</td></tr>` : ""}
      ${pkg.coverPage.dateOfLoss ? `<tr><td style="padding:8px 16px;font-size:12px;color:#6b7280;text-align:right;border-bottom:1px solid #e5e7eb;">Date of Loss</td><td style="padding:8px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${pkg.coverPage.dateOfLoss}</td></tr>` : ""}
    </tbody>
  </table>

  <div style="text-align:center;margin-bottom:24px;">
    <span style="display:inline-block;padding:4px 16px;border-radius:9999px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;background:${isSupplement ? "#ede9fe" : "#dbeafe"};color:${isSupplement ? "#5b21b6" : "#1e40af"};">
      ${isSupplement ? "Supplement Package" : "Claim Package"}
    </span>
  </div>
</div>

<!-- Page Break -->
<div class="page-break"></div>

<!-- Executive Summary -->
<div style="max-width:800px;margin:0 auto;padding:48px 40px;">
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Executive Summary
  </h2>
  <p style="font-size:14px;color:#374151;line-height:1.8;">${pkg.executiveSummary}</p>

  ${requestedScopeHtml}

  <!-- Claim Information -->
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Claim Information
  </h2>
  <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
    <tbody>
      ${claimInfoRows}
    </tbody>
  </table>

  <!-- Findings -->
  ${pkg.scopeFindings.length > 0 ? `
  <div class="page-break"></div>
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Findings
  </h2>
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">Atlas identified ${pkg.scopeFindings.length} potential finding${pkg.scopeFindings.length === 1 ? "" : "s"} from the available evidence. All findings are potential — they require verification before action.</p>
  ${findingsHtml}
  ` : ""}

  <!-- Why Atlas Included This -->
  ${pkg.explanations.length > 0 ? `
  <div class="page-break"></div>
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Why Atlas Included This
  </h2>
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">Each finding is grounded in specific evidence. Atlas explains what it found, which documents support it, and why it matters.</p>
  ${explanationsHtml}
  ` : ""}

  <!-- Discrepancies -->
  ${pkg.discrepancies.length > 0 ? `
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Discrepancies
  </h2>
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">Atlas found the following discrepancies between sources. Both values are preserved — no silent resolution.</p>
  ${discrepanciesHtml}
  ` : ""}

  <!-- Supporting Evidence Index -->
  <div class="page-break"></div>
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Supporting Evidence Index
  </h2>
  ${pkg.evidenceItems.length > 0 ? `
  <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:#e5e7eb;">
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">#</th>
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Document</th>
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Type</th>
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Date</th>
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Relevance</th>
      </tr>
    </thead>
    <tbody>
      ${evidenceRows}
    </tbody>
  </table>
  ` : '<p style="font-size:13px;color:#6b7280;font-style:italic;">No evidence documents are currently linked to this claim.</p>'}

  <!-- Missing Information -->
  ${pkg.missingInformation.length > 0 ? `
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Missing Information
  </h2>
  <p style="font-size:12px;color:#6b7280;margin:0 0 12px;">The following required information was not found in the available records. This does not block package generation — the package is clearly labeled with what is missing.</p>
  ${missingHtml}
  ` : ""}

  <!-- Reconciliation Notes -->
  ${reconciliationHtml ? `
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Financial Reconciliation
  </h2>
  <ul style="padding-left:20px;">${reconciliationHtml}</ul>
  ` : ""}

  <!-- Timeline -->
  ${pkg.claimTimeline.length > 0 ? `
  <h2 style="font-size:20px;font-weight:700;color:#111827;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    Claim Timeline
  </h2>
  <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:#e5e7eb;">
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Date</th>
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Event</th>
        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Source</th>
      </tr>
    </thead>
    <tbody>
      ${timelineHtml}
    </tbody>
  </table>
  ` : ""}

  <!-- Disclaimer -->
  <div style="margin:40px 0 24px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
    <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.6;">
      <strong style="color:#374151;">Disclaimer:</strong> ${pkg.disclaimer}
    </p>
    <p style="margin:8px 0 0;font-size:10px;color:#9ca3af;">
      Package ID: ${pkg._id ?? "not assigned"} · Generated: ${pkg.coverPage.generatedDate} · 
      Evidence documents: ${pkg.evidenceItems.length} · Findings: ${pkg.scopeFindings.length} · 
      Missing items: ${pkg.missingInformation.length}
    </p>
  </div>
</div>

</body>
</html>`;
}
