import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  activateSecretsRuntimeSnapshot,
  clearSecretsRuntimeSnapshot,
  prepareSecretsRuntimeSnapshot,
} from "../secrets/runtime.js";
import {
  ensureAuthProfileStore,
  markAuthProfileUsed,
  saveAuthProfileStore,
} from "./auth-profiles.js";

describe("auth profile runtime snapshot persistence", () => {
  it("does not write resolved plaintext keys during usage updates", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auth-runtime-save-"));
    const agentDir = path.join(stateDir, "agents", "main", "agent");
    const authPath = path.join(agentDir, "auth-profiles.json");
    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        authPath,
        `${JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai:default": {
                type: "api_key",
                provider: "openai",
                keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const snapshot = await prepareSecretsRuntimeSnapshot({
        config: {},
        env: { OPENAI_API_KEY: "sk-runtime-openai" }, // pragma: allowlist secret
        agentDirs: [agentDir],
      });
      activateSecretsRuntimeSnapshot(snapshot);

      const runtimeStore = ensureAuthProfileStore(agentDir);
      expect(runtimeStore.profiles["openai:default"]).toMatchObject({
        type: "api_key",
        key: "sk-runtime-openai",
        keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
      });

      await markAuthProfileUsed({
        store: runtimeStore,
        profileId: "openai:default",
        agentDir,
      });

      const persisted = JSON.parse(await fs.readFile(authPath, "utf8")) as {
        profiles: Record<string, { key?: string; keyRef?: unknown }>;
      };
      expect(persisted.profiles["openai:default"]?.key).toBeUndefined();
      expect(persisted.profiles["openai:default"]?.keyRef).toEqual({
        source: "env",
        provider: "default",
        id: "OPENAI_API_KEY",
      });
    } finally {
      clearSecretsRuntimeSnapshot();
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("refreshes active auth runtime snapshots after auth store saves", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auth-runtime-refresh-"));
    const agentDir = path.join(stateDir, "agents", "main", "agent");
    const authPath = path.join(agentDir, "auth-profiles.json");
    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        authPath,
        `${JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai-codex:default": {
                type: "oauth",
                provider: "openai-codex",
                access: "stale-access",
                refresh: "stale-refresh",
                expires: 1,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const snapshot = await prepareSecretsRuntimeSnapshot({
        config: {},
        agentDirs: [agentDir],
      });
      activateSecretsRuntimeSnapshot(snapshot);

      expect(ensureAuthProfileStore(agentDir).profiles["openai-codex:default"]).toMatchObject({
        access: "stale-access",
      });

      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            "openai-codex:default": {
              type: "oauth",
              provider: "openai-codex",
              access: "fresh-access",
              refresh: "fresh-refresh",
              expires: Date.now() + 60_000,
            },
          },
        },
        agentDir,
      );

      await vi.waitFor(() => {
        expect(ensureAuthProfileStore(agentDir).profiles["openai-codex:default"]).toMatchObject({
          access: "fresh-access",
          refresh: "fresh-refresh",
        });
      });
    } finally {
      clearSecretsRuntimeSnapshot();
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
