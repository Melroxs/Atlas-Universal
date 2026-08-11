import { describe, expect, it } from "vitest";
import {
  buildCandidateFromArchive,
  candidateKey,
  clusterDocumentsByClaimNumber,
  deriveCustomerFromPath,
  extractClaimNumber,
  looksClaimRelated,
} from "./reconstruct";

const doc = (id: string, title: string, content = "") => ({ _id: id, title, content });

describe("extractClaimNumber", () => {
  it("extracts from claim-prefixed names", () => {
    expect(extractClaimNumber("claim-12345.pdf")).toBe("12345");
    expect(extractClaimNumber("Claim_88210044_invoice.pdf")).toBe("88210044");
    expect(extractClaimNumber("CLM2023001234_scope.pdf")).toBe("2023001234");
  });

  it("extracts from CL/CLM-prefixed codes", () => {
    expect(extractClaimNumber("CL88210044.pdf")).toBe("CL88210044");
    expect(extractClaimNumber("clm-0001234.xlsx")).toBe("0001234");
  });

  it("extracts a plain number followed by a separator or boundary", () => {
    expect(extractClaimNumber("88210044_invoice.pdf")).toBe("88210044");
    expect(extractClaimNumber("scope 88210044")).toBe("88210044");
  });

  it("does not extract bare numbers embedded mid-word or short ids", () => {
    expect(extractClaimNumber("invoice_88.pdf")).toBeNull();
    expect(extractClaimNumber("v2_final.pdf")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractClaimNumber("")).toBeNull();
    expect(extractClaimNumber(undefined as unknown as string)).toBeNull();
  });
});

describe("looksClaimRelated", () => {
  it("flags claim-domain language", () => {
    expect(looksClaimRelated("Estimate and scope for loss")).toBe(true);
    expect(looksClaimRelated("supplement request")).toBe(true);
    expect(looksClaimRelated("vendor invoice")).toBe(true);
  });

  it("does not flag unrelated content", () => {
    expect(looksClaimRelated("Q3 marketing plan")).toBe(false);
    expect(looksClaimRelated("")).toBe(false);
  });
});

describe("deriveCustomerFromPath", () => {
  it("derives the customer segment after Clients/ or Customers/", () => {
    expect(deriveCustomerFromPath("Clients/ABC Restoration/Claims/88210044/estimate.pdf")).toBe(
      "ABC Restoration",
    );
    expect(deriveCustomerFromPath("Customers/Jane Smith/2024/scope.pdf")).toBe("Jane Smith");
  });

  it("ignores structural segments that are not customer names", () => {
    expect(deriveCustomerFromPath("Clients/Claims/88210044/x.pdf")).toBeNull();
    expect(deriveCustomerFromPath("Clients/2024/88210044/x.pdf")).toBeNull();
    expect(deriveCustomerFromPath("no markers here")).toBeNull();
  });
});

describe("clusterDocumentsByClaimNumber", () => {
  it("groups documents by a shared claim number (deterministic grouping)", () => {
    const clusters = clusterDocumentsByClaimNumber([
      doc("a", "88210044_estimate.pdf"),
      doc("b", "88210044_invoice.pdf"),
      doc("c", "88210044_supplement.pdf"),
      doc("d", "salary_policy.docx"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].claimNumber).toBe("88210044");
    expect(clusters[0].documentIds).toEqual(["a", "b", "c"]);
    expect(clusters[0].evidence).toHaveLength(3);
  });

  it("keeps distinct claim numbers in distinct clusters", () => {
    const clusters = clusterDocumentsByClaimNumber([
      doc("a", "CL88110001_estimate.pdf"),
      doc("b", "CL88220002_invoice.pdf"),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("normalizes casing so CL88110001 and cl88110001 cluster together", () => {
    const clusters = clusterDocumentsByClaimNumber([
      doc("a", "CL88110001_estimate.pdf"),
      doc("b", "cl88110001_invoice.pdf"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].documentIds).toEqual(["a", "b"]);
  });

  it("never creates a candidate from a document with no claim identifier (ambiguous)", () => {
    const clusters = clusterDocumentsByClaimNumber([
      doc("a", "general_letter.pdf", "no numbers here at all"),
      doc("b", "misc_notes.txt"),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it("accepts content-only matches as a weaker signal but still requires the number", () => {
    const clusters = clusterDocumentsByClaimNumber([
      doc("a", "damage report", "we discussed claim 99210044 yesterday"),
      doc("b", "unrelated", "nothing claim-related"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].claimNumber).toBe("99210044");
    expect(clusters[0].confidence).toBeLessThan(0.78); // weaker than a title match
  });

  it("raises confidence with more evidence but never reaches certainty", () => {
    const one = clusterDocumentsByClaimNumber([doc("a", "88210044_estimate.pdf")])[0];
    const many = clusterDocumentsByClaimNumber([
      doc("a", "88210044_estimate.pdf"),
      doc("b", "88210044_invoice.pdf"),
      doc("c", "88210044_scope.pdf"),
    ])[0];
    expect(many.confidence).toBeGreaterThan(one.confidence);
    expect(many.confidence).toBeLessThanOrEqual(0.95);
    expect(one.confidence).toBe(0.78);
  });

  it("states clearly that the candidate is POTENTIAL, never authoritative", () => {
    const clusters = clusterDocumentsByClaimNumber([doc("a", "88210044_estimate.pdf")]);
    expect(clusters[0].basis).toMatch(/POTENTIAL/);
    expect(clusters[0].basis).toMatch(/person confirms/);
  });

  it("preserves provenance by listing the exact evidence that formed the cluster", () => {
    const clusters = clusterDocumentsByClaimNumber([
      doc("a", "88210044_estimate.pdf"),
      doc("b", "88210044_invoice.pdf"),
    ]);
    expect(clusters[0].evidence).toEqual(["88210044_estimate.pdf", "88210044_invoice.pdf"]);
  });
});

describe("buildCandidateFromArchive", () => {
  it("derives the customer from sample paths and clamps confidence", () => {
    const c = buildCandidateFromArchive({
      claimNumber: "88210044",
      fileCount: 9,
      confidence: 0.9,
      samplePaths: [
        "Clients/ABC Restoration/Claims/88210044/estimate.pdf",
        "Clients/ABC Restoration/Claims/88210044/invoice.pdf",
      ],
    });
    expect(c.claimKey).toBe("88210044");
    expect(c.customer).toBe("ABC Restoration");
    expect(c.confidence).toBe(0.9);
    expect(c.basis).toMatch(/POTENTIAL/);
  });

  it("never reports confidence above 0.95 or below 0.35", () => {
    const high = buildCandidateFromArchive({
      claimNumber: "1",
      fileCount: 500,
      confidence: 1,
      samplePaths: ["x.pdf"],
    });
    expect(high.confidence).toBe(0.95);
    const low = buildCandidateFromArchive({
      claimNumber: "2",
      fileCount: 1,
      confidence: 0.1,
      samplePaths: ["x.pdf"],
    });
    expect(low.confidence).toBe(0.35);
  });
});

describe("candidateKey — tenant isolation", () => {
  it("scopes dedupe keys per tenant so identical claim numbers never collide", () => {
    const a = candidateKey("tenant-A", "88210044");
    const b = candidateKey("tenant-B", "88210044");
    expect(a).not.toBe(b);
    expect(candidateKey("tenant-A", "88210044")).toBe(a); // idempotent within a tenant
    // The caller normalizes before keying — the key itself is case-sensitive
    // so normalization must happen upstream (verified in cluster tests above).
    expect(candidateKey("tenant-A", "CL88210044")).not.toBe(
      candidateKey("tenant-A", "cl88210044"),
    );
  });

  it("distinguishes different claim numbers inside the same tenant", () => {
    expect(candidateKey("tenant-A", "88210044")).not.toBe(
      candidateKey("tenant-A", "88210045"),
    );
  });
});
