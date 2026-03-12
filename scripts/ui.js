#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeWindowsShellArgs,
  buildPnpmInvocation,
  resolvePnpmRunner,
} from "./package-runner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const uiDir = path.join(repoRoot, "ui");

function usage() {
  // keep this tiny; it's invoked from npm scripts too
  process.stderr.write("Usage: node scripts/ui.js <install|dev|build|test> [...args]\n");
}
export { assertSafeWindowsShellArgs, shouldUseShellForCommand } from "./package-runner.js";

export function resolveRunner(env = process.env, platform = process.platform) {
  return resolvePnpmRunner({ env, platform });
}

function createSpawnOptions(invocation, envOverride) {
  if (invocation.shell) {
    assertSafeWindowsShellArgs(invocation.args);
  }
  return {
    cwd: uiDir,
    stdio: "inherit",
    env: envOverride ?? process.env,
    ...(invocation.shell ? { shell: true } : {}),
  };
}

function run(invocation) {
  let child;
  try {
    child = spawn(invocation.command, invocation.args, createSpawnOptions(invocation));
  } catch (err) {
    console.error(`Failed to launch ${invocation.command}:`, err);
    process.exit(1);
    return;
  }

  child.on("error", (err) => {
    console.error(`Failed to launch ${invocation.command}:`, err);
    process.exit(1);
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      process.exit(code ?? 1);
    }
  });
}

function runSync(invocation, envOverride) {
  let result;
  try {
    result = spawnSync(
      invocation.command,
      invocation.args,
      createSpawnOptions(invocation, envOverride),
    );
  } catch (err) {
    console.error(`Failed to launch ${invocation.command}:`, err);
    process.exit(1);
    return;
  }
  if (result.signal) {
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function depsInstalled(kind) {
  try {
    const require = createRequire(path.join(uiDir, "package.json"));
    require.resolve("vite");
    require.resolve("dompurify");
    if (kind === "test") {
      require.resolve("vitest");
      require.resolve("@vitest/browser-playwright");
      require.resolve("playwright");
    }
    return true;
  } catch {
    return false;
  }
}

function resolveScriptAction(action) {
  if (action === "install") {
    return null;
  }
  if (action === "dev") {
    return "dev";
  }
  if (action === "build") {
    return "build";
  }
  if (action === "test") {
    return "test";
  }
  return null;
}

export function main(argv = process.argv.slice(2)) {
  const [action, ...rest] = argv;
  if (!action) {
    usage();
    process.exit(2);
  }

  const runner = resolveRunner();
  if (!runner) {
    process.stderr.write("Missing UI runner: install pnpm or expose corepack, then retry.\n");
    process.exit(1);
  }

  const script = resolveScriptAction(action);
  if (action !== "install" && !script) {
    usage();
    process.exit(2);
  }

  if (action === "install") {
    run(buildPnpmInvocation(runner, ["install", ...rest]));
    return;
  }

  if (!depsInstalled(action === "test" ? "test" : "build")) {
    const installEnv =
      action === "build" ? { ...process.env, NODE_ENV: "production" } : process.env;
    const installArgs = action === "build" ? ["install", "--prod"] : ["install"];
    runSync(buildPnpmInvocation(runner, installArgs), installEnv);
  }

  run(buildPnpmInvocation(runner, ["run", script, ...rest]));
}

const isDirectExecution = (() => {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
})();

if (isDirectExecution) {
  main();
}
