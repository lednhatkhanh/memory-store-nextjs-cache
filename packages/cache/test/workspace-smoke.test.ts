import { describe, expect, it } from "vitest";

import { packageIdentity } from "../src/index.js";

describe("cache package workspace seam", () => {
  it("exposes its stable package identity", () => {
    expect(packageIdentity).toBe("unicorn-nextjs-memory-cache");
  }, 1_000);
});
