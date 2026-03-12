import fs from "node:fs";
import path from "node:path";
import { resolveExecutablePath } from "../infra/executable-path.js";
import { note } from "../terminal/note.js";

function resolvePnpmInstallCommand(env: NodeJS.ProcessEnv = process.env): string {
  if (resolveExecutablePath("pnpm", { env })) {
    return "pnpm install";
  }
  if (resolveExecutablePath("corepack", { env })) {
    return "corepack pnpm install";
  }
  return "pnpm install";
}

export function noteSourceInstallIssues(root: string | null) {
  if (!root) {
    return;
  }

  const workspaceMarker = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceMarker)) {
    return;
  }

  const warnings: string[] = [];
  const installCommand = resolvePnpmInstallCommand();
  const nodeModules = path.join(root, "node_modules");
  const pnpmStore = path.join(nodeModules, ".pnpm");
  const tsxBin = path.join(nodeModules, ".bin", "tsx");
  const srcEntry = path.join(root, "src", "entry.ts");

  if (fs.existsSync(nodeModules) && !fs.existsSync(pnpmStore)) {
    warnings.push(
      `- node_modules was not installed by pnpm (missing node_modules/.pnpm). Run: ${installCommand}`,
    );
  }

  if (fs.existsSync(path.join(root, "package-lock.json"))) {
    warnings.push(
      `- package-lock.json present in a pnpm workspace. If you ran npm install, remove it and reinstall with ${installCommand}.`,
    );
  }

  if (fs.existsSync(srcEntry) && !fs.existsSync(tsxBin)) {
    warnings.push(`- tsx binary is missing for source runs. Run: ${installCommand}`);
  }

  if (warnings.length > 0) {
    note(warnings.join("\n"), "Install");
  }
}
