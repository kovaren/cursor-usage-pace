import { describe, expect, it } from "vitest";
import { mask } from "./util/redact";

describe("mask", () => {
  it("returns (empty) for empty inputs", () => {
    expect(mask(undefined)).toBe("(empty)");
    expect(mask(null)).toBe("(empty)");
    expect(mask("")).toBe("(empty)");
  });

  it("redacts short values to a length-only marker", () => {
    expect(mask("abc")).toBe("(redacted, len=3)");
    expect(mask("12345678")).toBe("(redacted, len=8)");
  });

  it("shows only first 4 and last 4 characters of longer secrets", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
    expect(mask(jwt)).toBe(`eyJh…ture (len=${jwt.length})`);
  });

  it("never includes the middle of the secret", () => {
    const secret = "aaaaSECRETMIDDLEzzzz";
    const result = mask(secret);
    expect(result).not.toContain("SECRETMIDDLE");
  });

  it("trims whitespace before measuring length", () => {
    const padded = "   abcdefgh   ";
    expect(mask(padded)).toBe("(redacted, len=8)");
  });
});
