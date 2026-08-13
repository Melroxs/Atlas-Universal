import { describe, expect, it } from "vitest";
import { parseFile, UnsupportedFormatError } from "./parsers";

const txt = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00,
  0x01, 0x5c, 0x9c, 0x6e, 0x67, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

describe("parseFile — canonical parsing", () => {
  it("returns an honest image result — never fabricates text from pixels", async () => {
    const res = await parseFile("image/png", "photo.png", PNG.buffer as ArrayBuffer);
    expect(res.image).toBe(true);
    expect(res.kind).toBe("image");
    expect(res.text).toBe("");
    expect(res.mimeType).toBe("image/png");
  });

  it("parses .eml with normalized metadata preserved", async () => {
    const eml = [
      "From: claims@lonestarmutual.example",
      "To: office@npproofing.example",
      "Subject: Re: Supplement GAP-26-51847",
      "Date: Thu, 2 Apr 2026 09:14:00 -0500",
      "",
      "We received the supplement request for claim GAP-26-51847.",
      "We need the signed authorization before review.",
    ].join("\r\n");
    const res = await parseFile("message/rfc822", "carrier.eml", txt(eml));
    expect(res.kind).toBe("email");
    expect(res.email?.subject).toContain("Supplement GAP-26-51847");
    expect(res.email?.from).toContain("lonestarmutual");
    expect(res.text).toContain("Subject: Re: Supplement GAP-26-51847");
    expect(res.text).toContain("signed authorization");
  });

  it("parses csv with a header line preserved", async () => {
    const csv = "Item,Amount\nRoof,24500\nGutters,3100\n";
    const res = await parseFile("text/csv", "ledger.csv", txt(csv));
    expect(res.kind).toBe("csv");
    expect(res.text).toContain("Columns: Item,Amount");
    expect(res.text).toContain("Roof,24500");
  });

  it("throws UnsupportedFormatError for legacy .doc", async () => {
    await expect(
      parseFile("application/msword", "old.doc", txt("nothing")),
    ).rejects.toThrow(UnsupportedFormatError);
  });

  it("throws UnsupportedFormatError for archives uploaded as documents", async () => {
    await expect(
      parseFile("application/zip", "pkg.zip", txt("PK\u0003\u0004junk")),
    ).rejects.toThrow(/archive importer/);
  });

  it("throws UnsupportedFormatError for unknown formats", async () => {
    await expect(
      parseFile("application/octet-stream", "weird.xyz", txt("data")),
    ).rejects.toThrow(UnsupportedFormatError);
  });
});
