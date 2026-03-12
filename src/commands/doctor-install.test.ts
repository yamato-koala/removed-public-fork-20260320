import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const note = vi.hoisted(() => vi.fn());

vi.mock("../terminal/note.js", () => ({
  note,
}));

import { noteSourceInstallIssues } from "./doctor-install.js";

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-doctor-install-"));
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - .\n", "utf8");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "entry.ts"), "export {};\n", "utf8");
  return root;
}

function writeExecutable(dir: string, name: string): string {
  const binName = process.platform === "win32" ? `${name}.CMD` : name;
  const binPath = path.join(dir, binName);
  fs.writeFileSync(binPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

describe("noteSourceInstallIssues", () => {
  const originalPath = process.env.PATH;
  const originalPathext = process.env.PATHEXT;

  beforeEach(() => {
    note.mockReset();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.PATHEXT = originalPathext;
  });

  it("suggests corepack pnpm install when pnpm is missing but corepack is available", () => {
    const root = makeTempRoot();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-corepack-only-"));
    writeExecutable(binDir, "corepack");
    process.env.PATH = binDir;
    process.env.PATHEXT = ".EXE;.CMD;.BAT";

    noteSourceInstallIssues(root);

    expect(note).toHaveBeenCalledTimes(1);
    const [message, title] = note.mock.calls[0] ?? [];
    expect(String(title)).toBe("Install");
    expect(String(message)).toContain("Run: corepack pnpm install");
    expect(String(message)).not.toContain("Run: pnpm install");
  });

  it("keeps suggesting pnpm install when a direct pnpm binary is available", () => {
    const root = makeTempRoot();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pnpm-bin-"));
    writeExecutable(binDir, "pnpm");
    process.env.PATH = binDir;
    process.env.PATHEXT = ".EXE;.CMD;.BAT";

    noteSourceInstallIssues(root);

    expect(note).toHaveBeenCalledTimes(1);
    const [message] = note.mock.calls[0] ?? [];
    expect(String(message)).toContain("Run: pnpm install");
    expect(String(message)).not.toContain("Run: corepack pnpm install");
  });
});
