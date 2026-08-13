import { describe, expect, it } from "vitest";
import { isHttpUrl, isJwt } from "./supabase";

const FALLBACK_URL = "https://ibxvzxblyhzwokljkslt.supabase.co";
const FALLBACK_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlieHZ6eGJseWh6d29rbGprc2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODM3NzYsImV4cCI6MjEwMjA1OTc3Nn0.12Fubl-jzjDaVaHQFCGrUQODTtZaeiGPNBGNjQoPhyc";

// Shape of the encrypted blobs the hosted build pipeline can inline for
// VITE_ vars (base64 of {"v":"v2","c":...,"k":[...]}).
const ENCRYPTED_BLOB =
  "eyJ2IjoidjIiLCJjIjoiUWpzTHRRN0tKZDl4QWRZMnZVOU5pMUdqL3dlMW9ZZmI3TUFZRGZ3aW02elFtSjRYVGRydkNTUGhZUmZSWjV2Mm5hTkpFNUNjVG9FU1RCZGVXYkdZNjRVajBWR3FwRzNxVWtCS3lOR1RBeTBCKzc4OFNRYWo5Q2FKeVFPUG50c2JDQitzZXV6aUhnbHlFTHBlSGJHQitwbmsyazlhZi9OcGE2M245NjlXUUdPUjgwR09QVE1Fb0RUT0VvM0RZaE9vZmZJcWFoSXU4Um90S1Z3bkNnTWJlMDdEcXlOL0hVNXhDeXhRdUUySms5VTRvK0JHQStjN045NUJuaXk4ZEN6cTlmaDd3dGNGY3pET1dPcTVteEtYcVY5RGFXWDJNZWtIcEsrQ3dDclF3WTJjMWpuT3JTVkdKekxEUHZNMFQrV3RjL0xnZXM0OWg2cWVNa1Y5MUtnTDdBLzBnVklLc3VGV3p6dEpQd2RILzR4ZVlaU3BoemZpb01KdjBqbHdtTFZRamZlcGNnOTgxa0JubExCc3VFaTVJV3F3d29sdXY3WVZIUDdOKzdnMXA5dVAyeU5qdmtRMW9qSGdLUm5JUHJwSmsybDlGd0JPZ2dXM2J5czRHUENSai9hMDd1TDgxTG9KOVVQd1l5SWNNSnhETDRIY29Xd1gvUE9YL0dEdXRNTnhmcmZoYlZOWXVKVlRxSE4rT05TVExDSERQcWFmUkhCclJSMEI5THVSRWo4THgvdm5paGxmOGJGVkd1VWE1UEJpaGVjU0dBPT0iLCJrIjpbMTg0LDEsMiwzLDAsMTIwLDEwNywxMTksMTUzLDIzLDIyMywxMTcsMTgzLDEyMCw1NywxOTYsMTEsMjgsMjQ5LDExOSwxMDQsMjEzLDE2OSwxNjEsMTQxLDE0Miw5OSw2NSw0OSwyMTIsMzAsMTk5LDk3LDIwNCwyMTgsNzcsMTA1LDE3OSwxLDU2LDIzNSwxMDcsMSwxMDAsNDcsMTkzLDIyMSwxMDAsNDgsNDMsMTMwLDQxLDE0NywyMzEsMjM3LDAsMCwwLDEyNiw0OCwxMjQsNiw5LDQyLDEzNCw3MiwxMzQsMjQ3LDEzLDEsNyw2LDE2MCwxMTEsNDgsMTA5LDIsMSwwLDQ4LDEwNCw2LDksNDIsMTM0LDcyLDEzNCwyNDcsMTMsMSw3LDEsNDgsMzAsNiw5LDk2LDEzNCw3MiwxLDEwMSwzLDQsMSw0Niw0OCwxNyw0LDEyLDIzOCw2LDE0MCwxODcsODcsNzAsMjMwLDE5OCwxNSw5NSwxNDIsMTYyLDIsMSwxNiwxMjgsNTksNDIsMjIyLDEwMSwxOTgsNjUsODgsNjYsMTA3LDI0MywxODUsNzgsMTU4LDE3LDE4OSw4NyAxODgsMjIzLDIxMCw5Niw0OSwxMDUsMjAzLDEzNiwxNTUsMjA4LDUxLDE0NSwyNiwxMjgsMTEwLDEzNywyMjQsMTkwLDI1NCw4NCwyMDEsNTcsOTUsMTYzLDk3LDIwLDIxMSwxMDEsOTMsMjIyLDE1NCwxMTUsMjAsMTA0LDcsMjEwLDU0LDQ2LDEyNywyMDYsMTQ3LDUsMTI2LDE5MF19";

describe("isHttpUrl", () => {
  it("accepts https Supabase URLs", () => {
    expect(isHttpUrl(FALLBACK_URL)).toBe(true);
  });

  it("rejects encrypted env blobs the hosted pipeline may inline", () => {
    expect(isHttpUrl(ENCRYPTED_BLOB)).toBe(false);
  });

  it("rejects undefined, empty and non-URL strings", () => {
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
  });
});

describe("isJwt", () => {
  it("accepts the public Supabase anon key", () => {
    expect(isJwt(FALLBACK_KEY)).toBe(true);
  });

  it("rejects encrypted env blobs the hosted pipeline may inline", () => {
    expect(isJwt(ENCRYPTED_BLOB)).toBe(false);
  });

  it("rejects undefined, empty and malformed values", () => {
    expect(isJwt(undefined)).toBe(false);
    expect(isJwt("")).toBe(false);
    expect(isJwt("abc")).toBe(false);
    expect(isJwt("a.b")).toBe(false);
  });
});
