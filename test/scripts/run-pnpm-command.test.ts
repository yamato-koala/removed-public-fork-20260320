import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRunPnpmInvocation } from "../../scripts/run-pnpm-command.js";

function writeExecutable(dir: string, name: string): string {
  const binName = process.platform === "win32" ? `${name}.CMD` : name;
  const binPath = path.join(dir, binName);
  fs.writeFileSync(binPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

describe("scripts/run-pnpm-command", () => {
  it("builds a corepack pnpm invocation when pnpm is not directly on PATH", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-run-pnpm-command-"));
    try {
      const platform = process.platform === "win32" ? "win32" : "linux";
      const env =
        platform === "win32"
          ? { Path: tempDir, PATHEXT: ".EXE;.CMD;.BAT" }
          : { PATH: tempDir, PATHEXT: ".EXE;.CMD;.BAT" };
      const corepackPath = writeExecutable(tempDir, "corepack");
      expect(
        resolveRunPnpmInvocation(["check:docs"], {
          env,
          platform,
        }),
      ).toEqual({
        command: corepackPath,
        args: ["pnpm", "check:docs"],
        shell: platform === "win32",
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
