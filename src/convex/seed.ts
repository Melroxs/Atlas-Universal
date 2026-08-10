import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { localEmbed } from "./ai/localEmbed";
import { chunkText } from "./lib/text";
import { requireTenant, requireUser } from "./helpers";
import { buildClaimFindings } from "./insurance/claims";

const SOP_TEXT = `Restoration SOP — Documentation Standards
Atlas Restoration Services, Inc.

1. Scope
This SOP defines the documentation required for every mitigation and reconstruction job. Documentation is the basis for invoicing and payment. A job without complete documentation will not be invoiced.

2. Required documentation
2.1 Signed authorization from the policyholder before any work begins. No mitigation or reconstruction may start without an executed authorization on file.
2.2 Dated photographs. All photos must include the date the photo was taken. Undated photos will not be accepted by carriers.
2.3 Drying log with daily moisture readings for water losses. Readings must be recorded every 12 hours while drying equipment is in place.
2.4 Xactimate estimate prepared for every claim. Estimates must be sent to the adjuster for approval before work begins.
2.5 Scope of work signed by the policyholder.
2.6 Invoice within 30 days of completion. Invoices reference the claim number and estimate line items.

3. Supplements
If hidden conditions are discovered during demolition, photograph them immediately, notify the adjuster Dan Whitfield in writing, and prepare a supplement for approval before additional work continues. Supplements over $500 require manager approval.

4. Carrier requirements
Northbrook Insurance requires net 30 payment terms. Invoices must reference the claim number, the policyholder name, and the approved estimate total. Claims without a signed authorization may be denied.

5. Current jobs
Project 1842 — Claim #1042, policyholder Maria Gonzalez, property at 1420 Cedar Lane. Estimate total $4,200. Inspection completed by adjuster Dan Whitfield on 2026-07-14. Photos dated and filed. The estimate was approved on 2026-07-20. Mitigation drying log is current. The project is scheduled for reconstruction. Invoice #1042 has not been marked paid in the accounting system.
Project 1907 — Claim #1187, policyholder James Okafor. Drying log shows readings on days 1-3 only; days 4-6 are missing. This documentation gap must be resolved before invoicing.`;

const CSV_TEXT = `project,invoice,status,amount,client,balance
1842,INV-1042,unpaid,4200.00,Maria Gonzalez,4200.00
1907,INV-1187,unpaid,6850.00,James Okafor,6850.00
1907,INV-1187-S1,supplement pending,950.00,James Okafor,950.00
1911,INV-1210,paid,2750.00,Sarah Kim,0.00
2015,INV-2015,unpaid,14500.00,Harborview Property Group,14500.00
2018,INV-2018,unpaid,6300.00,Brightfield Facilities LLC,6300.00
`;

const CARRIER_TEXT = `Northbrook Insurance — Carrier Requirements Brief

The following requirements apply to all vendor work performed for Northbrook Insurance policyholders.

1. Invoicing
Invoices must be submitted within 30 days of work completion. Invoices must reference the claim number and the approved estimate. Payment terms are net 30 from receipt of a complete, error-free invoice.

2. Supplements
Any change in scope must be approved in writing by the assigned adjuster before the additional work is performed. Failure to obtain written approval may result in denial of the supplement.

3. Documentation
Authorizations must be signed and dated before work begins. Moisture readings must be recorded on the drying log every 12 hours. All photos must be dated. Completed jobs require final photos of the restored area.

4. Claims contacts
Adjuster: Dan Whitfield (dwhitfield@northbrook.example, 410-555-0142)
Carrier claims line: 800-555-0100`;

const HANDBOOK_TEXT = `Employee Handbook — Atlas Restoration Services, Inc.

1. Work hours and attendance
Standard workweek is Monday through Friday, 7:00 AM to 4:00 PM, with a one-hour unpaid lunch. Field crews may be scheduled earlier during mitigation emergencies. Overtime must be approved in advance by a project manager; unapproved overtime is not paid.

2. Paid time off
Employees accrue PTO at 3.33 hours per two-week pay period (about 10 days per year). PTO requests must be submitted at least 48 hours in advance and approved by the direct supervisor. PTO does not accrue while on unpaid leave.

3. Expense reimbursement
Business expenses are reimbursed with an approved expense report within 15 days. Expenses over $250 require manager pre-approval. Mileage is reimbursed at the IRS standard rate. Receipts are required for every expense over $25.

4. Vehicle use
Company vehicles may be used for work purposes only; personal use is prohibited. Any accident must be reported to the office within 24 hours.

5. Safety
Personal protective equipment is required on all active job sites. Any workplace injury must be reported immediately and documented on the incident report form.

6. Payroll
Payroll is processed bi-weekly on Fridays by direct deposit. Time sheets must be submitted by 5:00 PM on the Wednesday before payday.

7. Conflict of interest
Employees may not direct company work to contractors in which they or family members hold an interest without written disclosure to the owner.`;

const CUSTOMERS_CSV = `customer_id,customer_name,company,type,since,ar_balance,email
C-101,Maria Gonzalez,,Residential,2024-03-12,4200.00,maria.gonzalez@example.com
C-102,James Okafor,,Residential,2025-01-08,7800.00,j.okafor@example.com
C-103,Sarah Kim,,Residential,2025-06-22,0.00,sarah.kim@example.com
C-201,Harborview Property Group,Harborview Property Group,Commercial,2023-11-05,14500.00,ap@harborview.example.com
C-202,Brightfield Facilities LLC,Brightfield Facilities LLC,Commercial,2024-09-17,6300.00,facilities@brightfield.example.com
C-203,Elena Ruiz,,Residential,2026-02-10,0.00,elena.ruiz@example.com
`;

const PROJECTS_CSV = `project_id,customer,type,status,estimate,start_date,end_date
1842,Maria Gonzalez,Mitigation,Active,4200.00,2026-07-10,
1907,James Okafor,Mitigation,Active,6850.00,2026-07-15,
1911,Sarah Kim,Reconstruction,Completed,2750.00,2026-06-01,2026-06-20
2015,Harborview Property Group,Reconstruction,Active,14500.00,2026-06-02,
2018,Brightfield Facilities LLC,Mitigation,On hold,9900.00,2026-07-05,
`;

const INVOICES_CSV = `invoice_id,project_id,customer,amount,issued,due,status
INV-1042,1842,Maria Gonzalez,4200.00,2026-07-21,2026-08-20,unpaid
INV-1187,1907,James Okafor,6850.00,2026-07-28,2026-08-27,unpaid
INV-1187-S1,1907,James Okafor,950.00,2026-08-02,2026-09-01,pending approval
INV-1210,1911,Sarah Kim,2750.00,2026-06-21,2026-07-21,paid
INV-2015,2015,Harborview Property Group,14500.00,2026-07-30,2026-08-29,unpaid
INV-2018,2018,Brightfield Facilities LLC,6300.00,2026-08-04,2026-09-03,unpaid
`;

const REPORT_TEXT = `2026 Q2 Performance Report — Atlas Restoration Services, Inc.
Prepared July 5, 2026.

1. Revenue by customer
Our largest customer by 2026 revenue is Harborview Property Group at $14,500 across Project 2015 (commercial reconstruction). Brightfield Facilities LLC follows at $9,900 (Project 2018, currently on hold pending permit). Residential revenue is led by James Okafor ($7,800 across two invoices) and Maria Gonzalez ($4,200).

2. Active projects
Five projects were active during the quarter: Projects 1842, 1907, 1911, 2015 and 2018. Two are now complete. Project 2015 (Harborview) is our largest active job at $14,500.

3. Accounts receivable
Outstanding receivables at quarter end total approximately $33,800 across five invoices. Aging is concentrated in commercial accounts. Harborview's INV-2015 ($14,500) is the single largest outstanding invoice.

4. Vendor and compliance
All field crews completed annual safety training in May. One documentation finding from Q1 (missing drying-log entries on Project 1907) remains open and is tracked with the carrier adjuster.

5. Outlook
Q3 revenue is expected to exceed Q2 as Project 2015 reconstruction accelerates.`;

const CONTRACT_TEXT = `Standard Service Agreement (Northbrook Insurance approved template)

1. Parties. This agreement is between Atlas Restoration Services, Inc. and the policyholder.

2. Scope of work. The contractor will perform the mitigation and reconstruction described in the attached scope of work and Xactimate estimate.

3. Payment. Invoices are due net 30 from the date of completion. The policyholder assigns insurance proceeds payable for the work directly to the contractor.

4. Supplements. Any change to the approved scope requires written approval from the assigned adjuster before the additional work begins. Supplements over $500 also require contractor manager approval.

5. Insurance. The contractor maintains general liability and workers' compensation insurance and will provide certificates upon request.

6. Warranty. The contractor warrants workmanship for one year from completion.

7. Disputes. Disputes are resolved through mediation before any legal action. Either party may request mediation within 30 days of a dispute arising.

8. Cancellation. Either party may cancel with written notice, but work already performed is payable.`;

export const seedDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);

    const existingDocs = await ctx.db
      .query("documents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    if (existingDocs.length > 0) {
      return { seeded: false, reason: "documents_exist" };
    }

    const now = Date.now();
    const samples: Array<{
      title: string;
      text: string;
      classification: "SOP" | "Spreadsheet" | "Report" | "Handbook" | "Contract";
      mimeType: string;
    }> = [
      {
        title: "Company SOP — Documentation Standards.docx",
        text: SOP_TEXT,
        classification: "SOP",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { title: "2026 Q3 Project Log.csv", text: CSV_TEXT, classification: "Spreadsheet", mimeType: "text/csv" },
      { title: "Northbrook Carrier Requirements Brief.md", text: CARRIER_TEXT, classification: "Report", mimeType: "text/markdown" },
      { title: "Employee Handbook.md", text: HANDBOOK_TEXT, classification: "Handbook", mimeType: "text/markdown" },
      { title: "Customers.csv", text: CUSTOMERS_CSV, classification: "Spreadsheet", mimeType: "text/csv" },
      { title: "Projects.csv", text: PROJECTS_CSV, classification: "Spreadsheet", mimeType: "text/csv" },
      { title: "Invoices.csv", text: INVOICES_CSV, classification: "Spreadsheet", mimeType: "text/csv" },
      { title: "2026 Q2 Performance Report.md", text: REPORT_TEXT, classification: "Report", mimeType: "text/markdown" },
      { title: "Standard Service Agreement.md", text: CONTRACT_TEXT, classification: "Contract", mimeType: "text/markdown" },
    ];

    const docIds: string[] = [];
    for (const sample of samples) {
      const docId = await ctx.db.insert("documents", {
        tenantId,
        title: sample.title,
        sourceType: "sample",
        mimeType: sample.mimeType,
        size: sample.text.length,
        classification: sample.classification,
        status: "ready",
        uploadedBy: userId,
        summary: sample.text.replace(/\s+/g, " ").slice(0, 320),
        processedAt: now,
      });
      const chunks = chunkText(sample.text);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.db.insert("documentChunks", {
          tenantId,
          documentId: docId as never,
          chunkIndex: i,
          content: chunks[i],
          embedding: localEmbed(chunks[i]),
        });
      }
      await ctx.db.patch(docId, { chunkCount: chunks.length, entityCount: 0 });
      docIds.push(String(docId));
    }

    // Entities — a realistic, cross-source company model.
    const entitySpecs: Array<{
      name: string;
      type: string;
      confidence: number;
      summary: string;
      doc: number;
    }> = [
      { name: "Maria Gonzalez", type: "policyholder", confidence: 0.9, summary: "Residential policyholder at 1420 Cedar Lane. Customer since 2024.", doc: 0 },
      { name: "James Okafor", type: "policyholder", confidence: 0.9, summary: "Residential policyholder, Project 1907. $7,800 outstanding across two invoices.", doc: 0 },
      { name: "Sarah Kim", type: "policyholder", confidence: 0.85, summary: "Residential customer, Project 1911 completed and paid.", doc: 6 },
      { name: "Elena Ruiz", type: "customer", confidence: 0.8, summary: "Residential customer since 2026, no active work.", doc: 4 },
      { name: "Harborview Property Group", type: "organization", confidence: 0.95, summary: "Largest customer by 2026 revenue ($14,500). Commercial reconstruction, Project 2015.", doc: 7 },
      { name: "Brightfield Facilities LLC", type: "organization", confidence: 0.95, summary: "Commercial customer. Project 2018 on hold pending permit.", doc: 4 },
      { name: "Northbrook Insurance", type: "organization", confidence: 0.95, summary: "Carrier. Net 30 terms; written supplement approval required.", doc: 2 },
      { name: "Dan Whitfield", type: "adjuster", confidence: 0.9, summary: "Adjuster for Northbrook Insurance.", doc: 2 },
      { name: "Claim #1042", type: "claim", confidence: 0.95, summary: "Water loss claim, project 1842, policyholder Maria Gonzalez.", doc: 0 },
      { name: "Claim #1187", type: "claim", confidence: 0.95, summary: "Water loss claim, project 1907, policyholder James Okafor.", doc: 0 },
      { name: "Project 1842", type: "project", confidence: 0.9, summary: "Active mitigation for Maria Gonzalez. $4,200.", doc: 1 },
      { name: "Project 1907", type: "project", confidence: 0.9, summary: "Active mitigation for James Okafor. $6,850; drying-log gap.", doc: 1 },
      { name: "Project 1911", type: "project", confidence: 0.85, summary: "Completed reconstruction for Sarah Kim. $2,750, paid.", doc: 5 },
      { name: "Project 2015", type: "project", confidence: 0.9, summary: "Active commercial reconstruction for Harborview Property Group. $14,500.", doc: 5 },
      { name: "Project 2018", type: "project", confidence: 0.85, summary: "Mitigation for Brightfield Facilities LLC, on hold pending permit. $9,900.", doc: 5 },
      { name: "INV-1042", type: "financial", confidence: 0.9, summary: "Invoice for Claim #1042 — unpaid, balance $4,200.", doc: 1 },
      { name: "INV-1187", type: "financial", confidence: 0.9, summary: "Invoice for Claim #1187 — unpaid, balance $6,850.", doc: 1 },
      { name: "INV-1187-S1", type: "financial", confidence: 0.85, summary: "Supplement invoice for Project 1907 — pending approval, $950.", doc: 1 },
      { name: "INV-1210", type: "financial", confidence: 0.85, summary: "Invoice for Project 1911 — paid.", doc: 1 },
      { name: "INV-2015", type: "financial", confidence: 0.9, summary: "Invoice for Project 2015 (Harborview) — unpaid, $14,500.", doc: 6 },
      { name: "INV-2018", type: "financial", confidence: 0.85, summary: "Invoice for Project 2018 (Brightfield) — unpaid, $6,300.", doc: 6 },
      { name: "1420 Cedar Lane", type: "property", confidence: 0.85, summary: "Property for Claim #1042.", doc: 0 },
      { name: "Xactimate", type: "system", confidence: 0.95, summary: "Estimating software used for claims.", doc: 0 },
    ];
    const entityIds: string[] = [];
    const entityIdByName = new Map<string, string>();
    for (const spec of entitySpecs) {
      const id = await ctx.db.insert("entities", {
        tenantId,
        entityTypeKey: spec.type,
        name: spec.name,
        summary: spec.summary,
        status: "proposed",
        confidence: spec.confidence,
        sourceDocumentId: docIds[spec.doc] as never,
        firstObservedAt: now,
        lastObservedAt: now,
      });
      entityIds.push(String(id));
      entityIdByName.set(spec.name, String(id));
    }

    // Relationships (subject → object).
    const relSpecs: Array<[string, string, string]> = [
      ["Claim #1042", "belongs_to", "Maria Gonzalez"],
      ["Claim #1187", "belongs_to", "James Okafor"],
      ["Claim #1042", "covered_by", "Northbrook Insurance"],
      ["Claim #1042", "handled_by", "Dan Whitfield"],
      ["Claim #1042", "located_at", "1420 Cedar Lane"],
      ["Claim #1042", "priced_with", "Xactimate"],
      ["INV-1042", "references", "Claim #1042"],
      ["INV-1187", "references", "Claim #1187"],
      ["Project 1842", "belongs_to", "Maria Gonzalez"],
      ["Project 1907", "belongs_to", "James Okafor"],
      ["Project 1911", "belongs_to", "Sarah Kim"],
      ["Project 2015", "belongs_to", "Harborview Property Group"],
      ["Project 2018", "belongs_to", "Brightfield Facilities LLC"],
      ["INV-1042", "references", "Project 1842"],
      ["INV-1187", "references", "Project 1907"],
      ["INV-2015", "references", "Project 2015"],
      ["INV-2018", "references", "Project 2018"],
    ];
    for (const [sub, type, obj] of relSpecs) {
      const s = entityIdByName.get(sub);
      const o = entityIdByName.get(obj);
      if (!s || !o) continue;
      await ctx.db.insert("entityRelationships", {
        tenantId,
        subjectEntityId: s as never,
        relationshipTypeKey: type,
        objectEntityId: o as never,
        confidence: 0.85,
        sourceDocumentId: docIds[0] as never,
        evidence: "Extracted from sample knowledge base.",
      });
    }

    // Knowledge assertions — the canonical classes.
    const assertions: Array<{
      classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
      statement: string;
      confidence: number;
    }> = [
      {
        classification: "FACT",
        statement: "Harborview Property Group is the largest customer by 2026 revenue at $14,500 (Project 2015).",
        confidence: 0.85,
      },
      {
        classification: "FACT",
        statement: "Five invoices totaling approximately $33,800 are unpaid or pending approval as of early August 2026.",
        confidence: 0.8,
      },
      {
        classification: "FACT",
        statement: "Invoice INV-1042 for Claim #1042 has not been marked paid in the accounting system.",
        confidence: 0.9,
      },
      {
        classification: "RULE",
        statement: "Per the company SOP, documentation must include a signed authorization, dated photos and — for water losses — a drying log before invoicing.",
        confidence: 0.85,
      },
      {
        classification: "RULE",
        statement: "Per the standard service agreement, any supplement requires written adjuster approval before the work begins.",
        confidence: 0.85,
      },
      {
        classification: "OBSERVATION",
        statement: "Commercial customers carry the largest outstanding balances; INV-2015 at $14,500 is the single largest receivable.",
        confidence: 0.75,
      },
      {
        classification: "INFERENCE",
        statement: "Project 1907 appears likely to require a supplement based on missing drying-log days and the pending supplement invoice.",
        confidence: 0.62,
      },
      {
        classification: "RECOMMENDATION",
        statement: "Request the missing drying-log readings for Project 1907 and submit the documentation package for review before invoicing.",
        confidence: 0.7,
      },
    ];
    for (const a of assertions) {
      await ctx.db.insert("knowledgeAssertions", {
        tenantId,
        classification: a.classification,
        statement: a.statement,
        confidence: a.confidence,
        status: "proposed",
        evidence: "Sample knowledge base.",
      });
    }

    // Evidence-backed recommendations for the decision center.
    const rec1 = await ctx.db.insert("recommendations", {
      tenantId,
      title: "Resolve documentation gap on Project 1907",
      summary:
        "The drying log for Claim #1187 is missing readings for days 4–6, which will delay invoicing.",
      reason:
        "Restoration workflow expects a complete drying log before invoicing. Missing days put payment at risk.",
      classification: "RECOMMENDATION",
      detectorKey: "demo_doc_gap",
      priority: "high",
      confidence: 0.8,
      expectedImpact: "Unblocks $6,850 invoice.",
      risk: "Carrier may deny the invoice without a complete log.",
      requiredApprovalMode: "APPROVE",
      status: "open",
    });
    await ctx.db.insert("recommendationEvidence", {
      recommendationId: rec1,
      kind: "chunk",
      documentId: docIds[0] as never,
      title: "Company SOP — Documentation Standards.docx",
      snippet: "Project 1907 — Claim #1187... Drying log shows readings on days 1-3 only; days 4-6 are missing.",
      relevance: 0.9,
    });

    const rec2 = await ctx.db.insert("recommendations", {
      tenantId,
      title: "Follow up on unpaid invoice INV-1042",
      summary: "Invoice #1042 ($4,200) for Claim #1042 has not been marked paid.",
      reason: "Net 30 terms with Northbrook Insurance; the invoice appears outstanding.",
      classification: "RECOMMENDATION",
      detectorKey: "demo_unpaid",
      priority: "medium",
      confidence: 0.75,
      expectedImpact: "Recover $4,200 of receivables.",
      risk: "Aging receivables reduce cash flow.",
      requiredApprovalMode: "APPROVE",
      status: "open",
    });
    await ctx.db.insert("recommendationEvidence", {
      recommendationId: rec2,
      kind: "entity",
      entityId: entityIdByName.get("INV-1042") as never,
      title: "INV-1042",
      snippet: "Invoice for Claim #1042 — unpaid, balance $4,200.",
      relevance: 0.9,
    });

    const rec3 = await ctx.db.insert("recommendations", {
      tenantId,
      title: "Follow up on the largest receivable — INV-2015",
      summary:
        "Harborview Property Group's $14,500 invoice (Project 2015) is the largest outstanding receivable.",
      reason:
        "Commercial aging concentrates risk; INV-2015 is 23% of all outstanding receivables.",
      classification: "RECOMMENDATION",
      detectorKey: "demo_large_receivable",
      priority: "high",
      confidence: 0.8,
      expectedImpact: "Recover $14,500 — the single largest receivable.",
      risk: "Concentration of receivables in one account.",
      requiredApprovalMode: "APPROVE",
      status: "open",
    });
    await ctx.db.insert("recommendationEvidence", {
      recommendationId: rec3,
      kind: "entity",
      entityId: entityIdByName.get("INV-2015") as never,
      title: "INV-2015",
      snippet: "Invoice for Project 2015 (Harborview) — unpaid, $14,500.",
      relevance: 0.9,
    });

    // Google Drive connector — honest "not connected" state (OAuth needed).
    const driveConn = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("provider"), "google_drive"))
      .first();
    if (!driveConn) {
      await ctx.db.insert("connections", {
        tenantId,
        name: "Google Drive",
        provider: "google_drive",
        category: "document_storage",
        status: "disconnected",
        notes: "Connect with Google OAuth to sync SOPs, proposals and photos.",
        settings: { kind: "oauth2" },
      });
    }

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "demo_data_seeded",
      targetType: "tenant",
      metadata: {
        documents: samples.length,
        entities: entitySpecs.length,
        assertions: assertions.length,
      },
    });

    return {
      seeded: true,
      documents: samples.length,
      entities: entitySpecs.length,
      assertions: assertions.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Phase 12 — labeled RESTORATION DEMO claims (Insurance Restoration vertical)
//
// Realistic but clearly-marked demo records so the MVP story works end-to-end:
// “What money are we leaving on the table?” → open the top claim → “what's
// missing?” → “build the claim package” → “find potential supplements” →
// “draft the supplement”. Every record is explicitly labeled DEMO — never
// represented as real customer information.
// ---------------------------------------------------------------------------

const DEMO_CLAIMS = [
  {
    claimNumber: "CLM-1042",
    customer: "Maria Gonzalez (DEMO)",
    property: "1420 Cedar Lane (DEMO)",
    carrier: "Northbrook Insurance",
    policy: "NB-HO-1042",
    adjuster: "Dan Whitfield",
    dateOfLoss: Date.UTC(2026, 6, 1),
    causeOfLoss: "Water damage — supply line burst",
    lossDescription: "Burst supply line flooded the finished basement; mitigation and reconstruction in progress.",
    status: "billing",
    estimateAmount: 4200,
    estimateLineItemCount: 12,
    invoicedAmount: 4200,
    approvedAmount: 4200,
    collectedAmount: 0,
    deductible: 1000,
    policyLimits: 50000,
    expectedScope: ["extraction", "drying", "demo", "drywall", "paint", "flooring"],
    actualScope: ["extraction", "drying", "demo", "drywall", "paint", "flooring"],
    evidenceSummary: ["damage", "scope", "quantity", "pricing", "necessity"],
    timeline: [
      { ts: Date.UTC(2026, 6, 3), kind: "note", label: "Inspection completed", detail: "Adjuster Dan Whitfield inspected the loss.", source: "source" },
      { ts: Date.UTC(2026, 6, 9), kind: "note", label: "Estimate approved", detail: "Carrier approved the $4,200 estimate.", source: "source" },
      { ts: Date.UTC(2026, 6, 25), kind: "note", label: "Invoice issued", detail: "Invoice INV-1042 for $4,200 — unpaid in accounting.", source: "source" },
    ],
  },
  {
    claimNumber: "CLM-1187",
    customer: "James Okafor (DEMO)",
    property: "88 Willow Court (DEMO)",
    carrier: "Northbrook Insurance",
    policy: "NB-HO-1187",
    adjuster: "Dan Whitfield",
    dateOfLoss: Date.UTC(2026, 5, 18),
    causeOfLoss: "Water damage — roof leak",
    lossDescription: "Roof leak damaged the attic and upper-floor ceilings; drying log has a documentation gap.",
    status: "supplement_prepared",
    estimateAmount: 6850,
    estimateLineItemCount: 9,
    invoicedAmount: 6850,
    collectedAmount: 0,
    deductible: 1000,
    policyLimits: 50000,
    expectedScope: ["extraction", "drying", "demo", "drywall", "paint"],
    actualScope: ["extraction", "drying", "demo", "drywall", "paint", "drying-extension"],
    evidenceSummary: ["damage", "scope"],
    timeline: [
      { ts: Date.UTC(2026, 5, 20), kind: "note", label: "Drying log started", detail: "Moisture readings recorded days 1–3 only; days 4–6 missing.", source: "source" },
      { ts: Date.UTC(2026, 6, 10), kind: "note", label: "Supplement opportunity identified", detail: "Additional drying equipment days beyond original scope.", source: "atlas" },
    ],
  },
  {
    claimNumber: "CLM-1210",
    customer: "Sarah Kim (DEMO)",
    property: "27 Birch Street (DEMO)",
    carrier: "Northbrook Insurance",
    policy: "NB-HO-1210",
    adjuster: "Dan Whitfield",
    dateOfLoss: Date.UTC(2026, 3, 5),
    causeOfLoss: "Water damage — appliance leak",
    lossDescription: "Washing machine leak — fully mitigated, reconstructed and paid.",
    status: "closed",
    estimateAmount: 2750,
    estimateLineItemCount: 6,
    invoicedAmount: 2750,
    approvedAmount: 2750,
    collectedAmount: 2750,
    paymentAmount: 2750,
    deductible: 500,
    policyLimits: 50000,
    expectedScope: ["extraction", "drying", "demo", "drywall", "paint"],
    actualScope: ["extraction", "drying", "demo", "drywall", "paint"],
    evidenceSummary: ["damage", "scope", "quantity", "pricing", "necessity"],
    timeline: [
      { ts: Date.UTC(2026, 3, 12), kind: "note", label: "Estimate approved", detail: "Carrier approved $2,750.", source: "source" },
      { ts: Date.UTC(2026, 4, 2), kind: "payment", label: "Payment received", detail: "$2,750 collected — claim fully reconciled.", source: "source" },
    ],
  },
  {
    claimNumber: "CLM-2015",
    customer: "Harborview Property Group (DEMO)",
    property: "44 Marina Drive, Bldg B (DEMO)",
    carrier: "Northbrook Insurance",
    policy: "NB-CP-2015",
    adjuster: "Rosa Delgado",
    dateOfLoss: Date.UTC(2026, 4, 22),
    causeOfLoss: "Wind and hail — roof and siding",
    lossDescription: "Storm damage to the roof and siding; invoiced total exceeds the priced estimate.",
    status: "billing",
    estimateAmount: 13000,
    estimateLineItemCount: 4,
    invoicedAmount: 14500,
    collectedAmount: 0,
    deductible: 2500,
    policyLimits: 100000,
    expectedScope: ["roof-tarp", "roof-replacement", "siding", "gutters", "windows", "cleanup"],
    actualScope: ["roof-tarp", "roof-replacement", "siding", "gutters", "windows", "cleanup"],
    evidenceSummary: ["damage", "scope", "quantity", "necessity"],
    timeline: [
      { ts: Date.UTC(2026, 4, 28), kind: "note", label: "Invoice issued", detail: "Invoice INV-2015 for $14,500 — exceeds the $13,000 estimate.", source: "source" },
    ],
  },
  {
    claimNumber: "CLM-2018",
    customer: "Brightfield Facilities LLC (DEMO)",
    property: "310 Commerce Park (DEMO)",
    carrier: "Northbrook Insurance",
    policy: "NB-CP-2018",
    adjuster: "Rosa Delgado",
    dateOfLoss: Date.UTC(2026, 3, 30),
    causeOfLoss: "Fire and smoke damage — warehouse office",
    lossDescription: "Office fire damage; invoiced in full but only partially paid — billing reconciliation needed.",
    status: "reconciling",
    estimateAmount: 6300,
    estimateLineItemCount: 8,
    invoicedAmount: 6300,
    paymentAmount: 3000,
    collectedAmount: 3000,
    deductible: 1000,
    policyLimits: 100000,
    expectedScope: ["demo", "drywall", "paint", "electrical", "flooring"],
    actualScope: ["demo", "drywall", "paint", "electrical", "flooring"],
    evidenceSummary: ["damage", "scope", "quantity", "pricing", "necessity"],
    timeline: [
      { ts: Date.UTC(2026, 5, 14), kind: "payment", label: "Partial payment received", detail: "$3,000 of the $6,300 invoice — $3,300 remains outstanding.", source: "source" },
    ],
  },
];

/**
 * Seed labeled demo claims (+ findings and a demo supplement draft).
 * Idempotent: skips when the workspace already has insurance claims.
 * All records are explicitly marked DEMO in their labels and provenance.
 */
export const seedDemoClaims = mutation({
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const existing = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .first();
    if (existing) {
      return { seeded: false, claims: 0, findings: 0, supplements: 0 };
    }

    const now = Date.now();
    const claims: string[] = [];
    for (const demo of DEMO_CLAIMS) {
      const id = await ctx.db.insert("insuranceClaims", {
        tenantId,
        claimNumber: demo.claimNumber,
        customer: demo.customer,
        property: demo.property,
        carrier: demo.carrier,
        policy: demo.policy,
        adjuster: demo.adjuster,
        dateOfLoss: demo.dateOfLoss,
        causeOfLoss: demo.causeOfLoss,
        lossDescription: demo.lossDescription,
        status: demo.status,
        currentStage: demo.status.replace(/_/g, " "),
        estimateAmount: demo.estimateAmount,
        estimateLineItemCount: demo.estimateLineItemCount,
        invoicedAmount: demo.invoicedAmount,
        paymentAmount: demo.paymentAmount ?? 0,
        approvedAmount: demo.approvedAmount,
        collectedAmount: demo.collectedAmount,
        deductible: demo.deductible,
        policyLimits: demo.policyLimits,
        expectedScope: demo.expectedScope,
        actualScope: demo.actualScope,
        evidenceSummary: demo.evidenceSummary,
        evidenceDocumentIds: [],
        timeline: demo.timeline,
        provenance: "DEMO DATA — sample claim for the restoration demo journey. Not real customer information.",
        confidence: 0.8,
        createdBy: userId,
        createdAt: now - claims.length * 86_400_000,
        updatedAt: now - claims.length * 86_400_000,
      });
      claims.push(String(id));

      // Persist deterministic findings exactly like runClaimAnalysis would.
      const drafts = buildClaimFindings({
        ...demo,
        _id: String(id),
        paymentAmount: demo.paymentAmount ?? 0,
      });
      for (const d of drafts) {
        await ctx.db.insert("claimFindings", {
          tenantId,
          claimId: id,
          findingKey: `claim:${String(id)}:${d.category}`,
          category: d.category,
          title: d.title,
          description: d.description,
          affectedEstimateItem: d.affectedEstimateItem,
          evidence: d.evidence,
          source: d.source,
          confidence: d.confidence,
          estimatedAmount: d.estimatedAmount,
          limitation: d.limitation,
          recommendedNextStep: d.recommendedNextStep,
          status: "open",
          createdAt: now - claims.length * 86_400_000,
          updatedAt: now - claims.length * 86_400_000,
        });
      }
    }

    // One demo supplement draft (James Okafor — additional drying days).
    const supClaim = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("claimNumber"), "CLM-1187"))
      .first();
    let supplements = 0;
    if (supClaim) {
      await ctx.db.insert("claimSupplements", {
        tenantId,
        claimId: supClaim._id,
        reason: "Additional drying equipment days beyond original scope (DEMO)",
        affectedLineItems: ["Drying — days 4–6"],
        requestedItems: ["Drying equipment — extended period"],
        evidence: [
          "Drying log days 1–3 on file; days 4–6 require moisture readings",
          "Documented scope does not include the drying extension",
        ],
        estimateDifference: 950,
        amount: 950,
        justification:
          "Draft assembled from documented scope vs performed scope — DEMO. Requires human review; drying-log days 4–6 must be completed first.",
        status: "draft",
        provenance: "DEMO DATA — sample supplement draft for the demo journey. Requires human review.",
        confidence: 0.6,
        createdBy: userId,
        createdAt: now - 86_400_000,
        updatedAt: now - 86_400_000,
      });
      supplements = 1;
    }

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "demo_claims_seeded",
      targetType: "tenant",
      metadata: { claims: claims.length, supplements },
    });

    return { seeded: true, claims: claims.length, findings: claims.length * 3, supplements };
  },
});
