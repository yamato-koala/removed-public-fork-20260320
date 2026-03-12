import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const META_SCRIPT_BARE_PNPM_RE = /(^|&&\s*|\|\|\s*|;\s*)pnpm(?=\s|$)/;

describe("package.json meta scripts", () => {
  it("do not rely on bare pnpm for nested script execution", () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const offenders = Object.entries(pkg.scripts ?? {})
      .filter(([, value]) => META_SCRIPT_BARE_PNPM_RE.test(value))
      .map(([name, value]) => `${name}: ${value}`);

    expect(offenders).toEqual([]);
  });
});
