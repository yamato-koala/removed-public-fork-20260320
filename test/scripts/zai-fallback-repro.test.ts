import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOpenClawInvocation } from "../../scripts/zai-fallback-repro.ts";

describe("scripts/zai-fallback-repro", () => {
  it("uses corepack when pnpm is unavailable on PATH", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-zai-runner-"));
    try {
      const corepackPath = path.join(tempDir, "corepack");
      fs.writeFileSync(corepackPath, "#!/bin/sh\n", "utf8");
      fs.chmodSync(corepackPath, 0o755);

      expect(
        resolveOpenClawInvocation(["openclaw", "agent", "--local"], { PATH: tempDir }, "linux"),
      ).toEqual({
        command: corepackPath,
        args: ["pnpm", "openclaw", "agent", "--local"],
        shell: false,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
