import { describe, expect, it } from "vitest";
import { RENDERER_PACKAGE_ID } from "./index";

describe("@er-explorer/renderer (Phase 0 scaffold)", () => {
  it("exports its package identity marker", () => {
    expect(RENDERER_PACKAGE_ID).toBe("@er-explorer/renderer");
  });
});
