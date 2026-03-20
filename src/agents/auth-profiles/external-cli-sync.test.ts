import { describe, expect, it, vi } from "vitest";
import { syncExternalCliCredentials } from "./external-cli-sync.js";
import type { AuthProfileStore } from "./types.js";

const {
  readCodexCliCredentialsCachedMock,
  readMiniMaxCliCredentialsCachedMock,
  readQwenCliCredentialsCachedMock,
} = vi.hoisted(() => ({
  readCodexCliCredentialsCachedMock: vi.fn(),
  readMiniMaxCliCredentialsCachedMock: vi.fn(),
  readQwenCliCredentialsCachedMock: vi.fn(),
}));

vi.mock("../cli-credentials.js", () => ({
  readCodexCliCredentialsCached: readCodexCliCredentialsCachedMock,
  readMiniMaxCliCredentialsCached: readMiniMaxCliCredentialsCachedMock,
  readQwenCliCredentialsCached: readQwenCliCredentialsCachedMock,
}));

describe("syncExternalCliCredentials", () => {
  it("syncs Codex CLI credentials into openai-codex:default instead of the deprecated codex-cli profile", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai-codex:codex-cli": {
          type: "oauth",
          provider: "openai-codex",
          access: "legacy-access",
          refresh: "legacy-refresh",
          expires: Date.now() - 60_000,
        },
      },
    };
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai-codex",
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: Date.now() + 60_000,
      accountId: "acct-1",
    });
    readMiniMaxCliCredentialsCachedMock.mockReturnValue(null);
    readQwenCliCredentialsCachedMock.mockReturnValue(null);

    const mutated = syncExternalCliCredentials(store);

    expect(mutated).toBe(true);
    expect(store.profiles["openai-codex:default"]).toMatchObject({
      type: "oauth",
      provider: "openai-codex",
      access: "fresh-access",
      refresh: "fresh-refresh",
      accountId: "acct-1",
    });
    expect(store.profiles["openai-codex:codex-cli"]).toMatchObject({
      access: "legacy-access",
    });
  });
});
