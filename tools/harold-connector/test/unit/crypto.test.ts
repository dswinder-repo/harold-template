import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { open, pkceChallenge, seal, verifyPkce } from "../../src/crypto.js";

const key = randomBytes(32);

describe("sealed tokens and codes (AES-256-GCM)", () => {
  it("round-trips every purpose", () => {
    for (const p of ["client", "state", "code", "access", "refresh"] as const) {
      const blob = seal(key, p, { gh: "gho_example", n: 42, exp: Math.floor(Date.now() / 1000) + 60 });
      expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(open(key, p, blob)).toMatchObject({ gh: "gho_example", n: 42 });
    }
  });

  it("rejects a tampered blob (every single-character change)", () => {
    const blob = seal(key, "access", { gh: "x", exp: Math.floor(Date.now() / 1000) + 60 });
    let rejected = 0;
    for (let i = 0; i < blob.length; i++) {
      const c = blob[i] === "A" ? "B" : "A";
      const t = blob.slice(0, i) + c + blob.slice(i + 1);
      if (t !== blob && open(key, "access", t) === null) rejected++;
    }
    // base64url's last character can carry unused padding bits; every other position must fail
    expect(rejected).toBeGreaterThanOrEqual(blob.length - 1);
    expect(open(key, "access", blob.slice(0, -4))).toBeNull();
    expect(open(key, "access", blob + "AAAA")).toBeNull();
  });

  it("rejects a blob sealed for another purpose (a code is not an access token)", () => {
    const code = seal(key, "code", { gh: "x" });
    expect(open(key, "access", code)).toBeNull();
    expect(open(key, "refresh", code)).toBeNull();
    const client = seal(key, "client", { redirect_uris: ["https://claude.ai/cb"] });
    expect(open(key, "access", client)).toBeNull();
  });

  it("rejects an expired blob and a blob from another key", () => {
    const expired = seal(key, "code", { gh: "x", exp: Math.floor(Date.now() / 1000) - 1 });
    expect(open(key, "code", expired)).toBeNull();
    const other = seal(randomBytes(32), "code", { gh: "x" });
    expect(open(key, "code", other)).toBeNull();
    expect(open(key, "code", "not a token")).toBeNull();
  });
});

describe("PKCE S256", () => {
  it("matches the RFC 7636 Appendix B example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });
  it("rejects a wrong, missing, short or malformed verifier", () => {
    const v = randomBytes(32).toString("base64url");
    const c = pkceChallenge(v);
    expect(verifyPkce(v, c)).toBe(true);
    expect(verifyPkce(randomBytes(32).toString("base64url"), c)).toBe(false);
    expect(verifyPkce(undefined, c)).toBe(false);
    expect(verifyPkce("short", pkceChallenge("short"))).toBe(false);
    expect(verifyPkce(v + " ", c)).toBe(false);
  });
});
