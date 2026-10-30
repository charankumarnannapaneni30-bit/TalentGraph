import { describe, expect, it } from "vitest";
import { isAllowedClientOrigin } from "./corsOrigin.js";

describe("client origin validation", () => {
  it("allows the configured client origin", () => {
    expect(isAllowedClientOrigin("http://localhost:5173", "http://localhost:5173", "production")).toBe(true);
  });

  it("allows localhost loopback aliases during development", () => {
    expect(isAllowedClientOrigin("http://127.0.0.1:5173", "http://localhost:5173", "development")).toBe(true);
  });

  it("rejects loopback aliases outside development", () => {
    expect(isAllowedClientOrigin("http://127.0.0.1:5173", "http://localhost:5173", "production")).toBe(false);
  });

  it("rejects other origins and ports", () => {
    expect(isAllowedClientOrigin("http://attacker.example:5173", "http://localhost:5173", "development")).toBe(false);
    expect(isAllowedClientOrigin("http://127.0.0.1:3000", "http://localhost:5173", "development")).toBe(false);
  });
});
