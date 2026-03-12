import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildPnpmInvocation, resolvePnpmRunnerOrThrow } from "./package-runner.js";

export function resolveRunPnpmInvocation(args, params = {}) {
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  const runner = resolvePnpmRunnerOrThrow({ env, platform });
  return buildPnpmInvocation(runner, args, platform);
}

export function runPnpmCommand(args, params = {}) {
  const env = params.env ?? process.env;
  const invocation = resolveRunPnpmInvocation(args, {
    env,
    platform: params.platform,
  });
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
    shell: invocation.shell,
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(runPnpmCommand(process.argv.slice(2)));
}
