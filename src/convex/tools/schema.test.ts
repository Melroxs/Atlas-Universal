// ---------------------------------------------------------------------------
// Input validation — model/client JSON is never executed blindly.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { TOOL_BY_ID } from "./registry";
import { validateToolInput } from "./schema";

const search = TOOL_BY_ID["drive.search_files"];
const create = TOOL_BY_ID["drive.create_file"];
const list = TOOL_BY_ID["drive.list_files"];
const update = TOOL_BY_ID["drive.update_file"];

describe("validateToolInput", () => {
  it("accepts a valid minimal payload", () => {
    const res = validateToolInput(search, { query: "ABC Restoration" });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.value.query).toBe("ABC Restoration");
  });

  it("rejects a missing required field", () => {
    const res = validateToolInput(search, {});
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toContain('"query" is required');
  });

  it("strips unknown keys instead of forwarding them", () => {
    const res = validateToolInput(search, { query: "x", evil: "drop_this" });
    expect(res.ok).toBe(true);
    expect(res.value).not.toHaveProperty("evil");
  });

  it("rejects a non-object payload", () => {
    expect(validateToolInput(search, "not an object").ok).toBe(false);
    expect(validateToolInput(search, 42).ok).toBe(false);
    expect(validateToolInput(search, ["query"]).ok).toBe(false);
  });

  it("coerces numeric strings into numbers and enforces min/max", () => {
    const ok = validateToolInput(search, { query: "x", limit: "5" });
    expect(ok.ok).toBe(true);
    expect(ok.value.limit).toBe(5);

    const tooBig = validateToolInput(search, { query: "x", limit: 51 });
    expect(tooBig.ok).toBe(false);
    expect(tooBig.errors.join(" ")).toContain("at most 50");

    const tooSmall = validateToolInput(search, { query: "x", limit: 0 });
    expect(tooSmall.ok).toBe(false);
  });

  it("rejects invalid enum values and accepts declared ones", () => {
    const bad = validateToolInput(search, {
      query: "x",
      orderBy: "size desc",
    });
    expect(bad.ok).toBe(false);

    const good = validateToolInput(search, {
      query: "x",
      orderBy: "modifiedTime desc",
    });
    expect(good.ok).toBe(true);
  });

  it("enforces string length limits", () => {
    const long = validateToolInput(create, {
      name: "x".repeat(300),
    });
    expect(long.ok).toBe(false);
    expect(long.errors.join(" ")).toContain("at most 200");
  });

  it("rejects wrong types for a field", () => {
    const badName = validateToolInput(create, { name: 42 });
    // numbers coerce to strings, so this is accepted; booleans are not
    const badBool = validateToolInput(list, { pageSize: true });
    expect(badBool.ok).toBe(false);
    expect(badName.ok).toBe(true);
  });

  it("validates multi-field write tools", () => {
    const res = validateToolInput(update, { fileId: "abc", name: "new.pdf" });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ fileId: "abc", name: "new.pdf" });

    const missing = validateToolInput(update, { name: "new.pdf" });
    expect(missing.ok).toBe(false);
  });
});
