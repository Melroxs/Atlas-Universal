import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { localEmbed } from "./ai/localEmbed";
import { chunkText } from "./lib/text";
import { requireTenant, requireUser } from "./helpers";

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
Project 1907 — Claim #1187, policyholder James Okafor. Drying log shows readings on days 1-3 only; days 4-6 are missing. This documentation gap must be resolved before invoicing.
`;

const CSV_TEXT = `project,invoice,status,amount,client,balance
1842,INV-1042,unpaid,4200.00,Maria Gonzalez,4200.00
1907,INV-1187,unpaid,6850.00,James Okafor,6850.00
1907,INV-1187-S1,supplement pending,950.00,James Okafor,950.00
1911,INV-1210,paid,2750.00,Sarah Kim,0.00
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
Carrier claims line: 800-555-0100
`;

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
      classification: "SOP" | "Spreadsheet" | "Report";
    }> = [
      { title: "Restoration SOP — Documentation Standards", text: SOP_TEXT, classification: "SOP" },
      { title: "2026 Q3 Project Log.csv", text: CSV_TEXT, classification: "Spreadsheet" },
      { title: "Northbrook Carrier Requirements Brief.md", text: CARRIER_TEXT, classification: "Report" },
    ];

    const docIds: string[] = [];
    for (const sample of samples) {
      const docId = await ctx.db.insert("documents", {
        tenantId,
        title: sample.title,
        sourceType: "sample",
        mimeType: "text/plain",
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

    // Entities
    const entitySpecs: Array<{
      name: string;
      type: string;
      confidence: number;
      summary: string;
      doc: number;
    }> = [
      { name: "Claim #1042", type: "claim", confidence: 0.95, summary: "Water loss claim, project 1842, policyholder Maria Gonzalez.", doc: 0 },
      { name: "Claim #1187", type: "claim", confidence: 0.95, summary: "Water loss claim, project 1907, policyholder James Okafor.", doc: 0 },
      { name: "Maria Gonzalez", type: "policyholder", confidence: 0.9, summary: "Policyholder at 1420 Cedar Lane.", doc: 0 },
      { name: "James Okafor", type: "policyholder", confidence: 0.9, summary: "Policyholder, project 1907.", doc: 0 },
      { name: "Dan Whitfield", type: "adjuster", confidence: 0.9, summary: "Adjuster for Northbrook Insurance.", doc: 2 },
      { name: "Northbrook Insurance", type: "organization", confidence: 0.95, summary: "Carrier. Net 30 terms; written supplement approval required.", doc: 2 },
      { name: "1420 Cedar Lane", type: "property", confidence: 0.85, summary: "Property for Claim #1042.", doc: 0 },
      { name: "Xactimate", type: "system", confidence: 0.95, summary: "Estimating software used for claims.", doc: 0 },
      { name: "INV-1042", type: "financial", confidence: 0.9, summary: "Invoice for Claim #1042 — unpaid, balance $4,200.", doc: 1 },
      { name: "INV-1187", type: "financial", confidence: 0.9, summary: "Invoice for Claim #1187 — unpaid, balance $6,850.", doc: 1 },
    ];
    const entityIds: string[] = [];
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
    }

    // Relationships (indexes: subject → object)
    const relSpecs: Array<[number, string, number]> = [
      [0, "belongs_to", 2],   // Claim #1042 → Maria Gonzalez
      [1, "belongs_to", 3],   // Claim #1187 → James Okafor
      [0, "covered_by", 5],   // Claim #1042 → Northbrook Insurance
      [0, "handled_by", 4],   // Claim #1042 → Dan Whitfield
      [0, "located_at", 6],   // Claim #1042 → 1420 Cedar Lane
      [0, "priced_with", 7],  // Claim #1042 → Xactimate
      [8, "references", 0],   // INV-1042 → Claim #1042
      [9, "references", 1],   // INV-1187 → Claim #1187
    ];
    for (const [sub, type, obj] of relSpecs) {
      await ctx.db.insert("entityRelationships", {
        tenantId,
        subjectEntityId: entityIds[sub] as never,
        relationshipTypeKey: type,
        objectEntityId: entityIds[obj] as never,
        confidence: 0.85,
        sourceDocumentId: docIds[0] as never,
        evidence: "Extracted from sample knowledge base.",
      });
    }

    // Knowledge assertions — the five canonical classes.
    const assertions: Array<{
      classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
      statement: string;
      confidence: number;
    }> = [
      {
        classification: "FACT",
        statement: "Invoice INV-1042 for Claim #1042 has not been marked paid in the accounting system.",
        confidence: 0.9,
      },
      {
        classification: "RULE",
        statement: "Per the company SOP, documentation must include dated photos and a signed authorization before work begins.",
        confidence: 0.85,
      },
      {
        classification: "OBSERVATION",
        statement: "Most projects move from inspection to estimate within three days in this knowledge base.",
        confidence: 0.7,
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

    // A couple of evidence-backed recommendations for the center.
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
      title: "Restoration SOP — Documentation Standards",
      snippet: "Project 1907 — Claim #1187... Drying log shows readings on days 1-3 only; days 4-6 are missing.",
      relevance: 0.9,
    });

    const rec2 = await ctx.db.insert("recommendations", {
      tenantId,
      title: "Follow up on unpaid invoice INV-1042",
      summary:
        "Invoice #1042 ($4,200) for Claim #1042 has not been marked paid.",
      reason:
        "Net 30 terms with Northbrook Insurance; the invoice appears outstanding.",
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
      entityId: entityIds[8] as never,
      title: "INV-1042",
      snippet: "Invoice for Claim #1042 — unpaid, balance $4,200.",
      relevance: 0.9,
    });

    // A planned Google Drive connection for the Connections center.
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
        notes: "Planned — connect to sync SOPs, proposals and photos.",
        settings: { kind: "oauth2", planned: true },
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
