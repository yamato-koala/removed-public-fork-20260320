import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { dispatchChannelMessageAction } from "../../channels/plugins/message-actions.js";
import type { ChannelId, ChannelThreadingToolContext } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import { appendAssistantMessageToSessionTranscript } from "../../config/sessions.js";
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
import {
  buildCanonicalSentMessageHookContext,
  toInternalMessageSentContext,
  toPluginMessageContext,
  toPluginMessageSentEvent,
} from "../../hooks/message-hook-mappers.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getAgentScopedMediaLocalRoots } from "../../media/local-roots.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import type { GatewayClientMode, GatewayClientName } from "../../utils/message-channel.js";
import { throwIfAborted } from "./abort.js";
import type { OutboundSendDeps } from "./deliver.js";
import type { MessagePollResult, MessageSendResult } from "./message.js";
import { sendMessage, sendPoll } from "./message.js";
import { extractToolPayload } from "./tool-payload.js";

const log = createSubsystemLogger("outbound/send-service");

export type OutboundGatewayContext = {
  url?: string;
  token?: string;
  timeoutMs?: number;
  clientName: GatewayClientName;
  clientDisplayName?: string;
  mode: GatewayClientMode;
};

export type OutboundSendContext = {
  cfg: OpenClawConfig;
  channel: ChannelId;
  params: Record<string, unknown>;
  /** Active agent id for per-agent outbound media root scoping. */
  agentId?: string;
  accountId?: string | null;
  gateway?: OutboundGatewayContext;
  toolContext?: ChannelThreadingToolContext;
  deps?: OutboundSendDeps;
  dryRun: boolean;
  mirror?: {
    sessionKey: string;
    agentId?: string;
    text?: string;
    mediaUrls?: string[];
  };
  abortSignal?: AbortSignal;
  silent?: boolean;
};

type PluginHandledResult = {
  handledBy: "plugin";
  payload: unknown;
  toolResult: AgentToolResult<unknown>;
};

function readPayloadObject(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

function readPayloadString(payload: unknown, key: string): string | undefined {
  const value = readPayloadObject(payload)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPayloadBoolean(payload: unknown, key: string): boolean | undefined {
  const value = readPayloadObject(payload)?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function resolvePluginHandledMessageId(payload: unknown): string | undefined {
  return (
    readPayloadString(payload, "messageId") ??
    readPayloadString(readPayloadObject(payload)?.result, "messageId")
  );
}

function resolvePluginHandledConversationId(payload: unknown, fallback: string): string {
  const directChatId = readPayloadObject(payload)?.chatId;
  if (typeof directChatId === "string" && directChatId.trim()) {
    return directChatId.trim();
  }
  if (typeof directChatId === "number" && Number.isFinite(directChatId)) {
    return String(Math.trunc(directChatId));
  }
  return fallback;
}

function resolvePluginHandledSendSuccess(payload: unknown): boolean {
  return readPayloadBoolean(payload, "ok") !== false;
}

function resolvePluginHandledSendError(payload: unknown): string | undefined {
  return (
    readPayloadString(payload, "error") ??
    readPayloadString(payload, "reason") ??
    readPayloadString(payload, "hint") ??
    readPayloadString(payload, "message")
  );
}

async function emitPluginHandledSendHooks(params: {
  ctx: OutboundSendContext;
  to: string;
  message: string;
  payload: unknown;
}): Promise<void> {
  const hookRunner = getGlobalHookRunner();
  const hasPluginMessageSentHooks = hookRunner?.hasHooks("message_sent") ?? false;
  const sessionKey =
    params.ctx.mirror?.sessionKey ??
    (typeof params.ctx.params.__sessionKey === "string"
      ? params.ctx.params.__sessionKey
      : undefined);
  if (!hasPluginMessageSentHooks && !sessionKey) {
    return;
  }

  const success = resolvePluginHandledSendSuccess(params.payload);
  const canonical = buildCanonicalSentMessageHookContext({
    to: params.to,
    content: params.ctx.mirror?.text ?? params.message,
    success,
    error: success ? undefined : resolvePluginHandledSendError(params.payload),
    channelId: params.ctx.channel,
    accountId: params.ctx.accountId ?? undefined,
    conversationId: resolvePluginHandledConversationId(params.payload, params.to),
    messageId: resolvePluginHandledMessageId(params.payload),
  });

  if (hasPluginMessageSentHooks) {
    try {
      await hookRunner!.runMessageSent(
        toPluginMessageSentEvent(canonical),
        toPluginMessageContext(canonical),
      );
    } catch (err) {
      log.warn(`plugin-handled send: message_sent plugin hook failed: ${String(err)}`);
    }
  }

  if (!sessionKey) {
    return;
  }

  try {
    await triggerInternalHook(
      createInternalHookEvent(
        "message",
        "sent",
        sessionKey,
        toInternalMessageSentContext(canonical),
      ),
    );
  } catch (err) {
    log.warn(`plugin-handled send: message:sent internal hook failed: ${String(err)}`);
  }
}

async function tryHandleWithPluginAction(params: {
  ctx: OutboundSendContext;
  action: "send" | "poll";
  onHandled?: (handled: AgentToolResult<unknown>, payload: unknown) => Promise<void> | void;
}): Promise<PluginHandledResult | null> {
  if (params.ctx.dryRun) {
    return null;
  }
  const mediaLocalRoots = getAgentScopedMediaLocalRoots(
    params.ctx.cfg,
    params.ctx.agentId ?? params.ctx.mirror?.agentId,
  );
  const handled = await dispatchChannelMessageAction({
    channel: params.ctx.channel,
    action: params.action,
    cfg: params.ctx.cfg,
    params: params.ctx.params,
    mediaLocalRoots,
    accountId: params.ctx.accountId ?? undefined,
    gateway: params.ctx.gateway,
    toolContext: params.ctx.toolContext,
    dryRun: params.ctx.dryRun,
  });
  if (!handled) {
    return null;
  }
  const payload = extractToolPayload(handled);
  await params.onHandled?.(handled, payload);
  return {
    handledBy: "plugin",
    payload,
    toolResult: handled,
  };
}

export async function executeSendAction(params: {
  ctx: OutboundSendContext;
  to: string;
  message: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  gifPlayback?: boolean;
  bestEffort?: boolean;
  replyToId?: string;
  threadId?: string | number;
}): Promise<{
  handledBy: "plugin" | "core";
  payload: unknown;
  toolResult?: AgentToolResult<unknown>;
  sendResult?: MessageSendResult;
}> {
  throwIfAborted(params.ctx.abortSignal);
  const pluginHandled = await tryHandleWithPluginAction({
    ctx: params.ctx,
    action: "send",
    onHandled: async (_handled, payload) => {
      if (!params.ctx.mirror) {
        await emitPluginHandledSendHooks({
          ctx: params.ctx,
          to: params.to,
          message: params.message,
          payload,
        });
        return;
      }
      const mirrorText = params.ctx.mirror.text ?? params.message;
      const mirrorMediaUrls =
        params.ctx.mirror.mediaUrls ??
        params.mediaUrls ??
        (params.mediaUrl ? [params.mediaUrl] : undefined);
      await appendAssistantMessageToSessionTranscript({
        agentId: params.ctx.mirror.agentId,
        sessionKey: params.ctx.mirror.sessionKey,
        text: mirrorText,
        mediaUrls: mirrorMediaUrls,
      });
      await emitPluginHandledSendHooks({
        ctx: params.ctx,
        to: params.to,
        message: params.message,
        payload,
      });
    },
  });
  if (pluginHandled) {
    return pluginHandled;
  }

  throwIfAborted(params.ctx.abortSignal);
  const result: MessageSendResult = await sendMessage({
    cfg: params.ctx.cfg,
    to: params.to,
    content: params.message,
    agentId: params.ctx.agentId,
    mediaUrl: params.mediaUrl || undefined,
    mediaUrls: params.mediaUrls,
    channel: params.ctx.channel || undefined,
    accountId: params.ctx.accountId ?? undefined,
    replyToId: params.replyToId,
    threadId: params.threadId,
    gifPlayback: params.gifPlayback,
    dryRun: params.ctx.dryRun,
    bestEffort: params.bestEffort ?? undefined,
    deps: params.ctx.deps,
    gateway: params.ctx.gateway,
    mirror: params.ctx.mirror,
    abortSignal: params.ctx.abortSignal,
    silent: params.ctx.silent,
  });

  return {
    handledBy: "core",
    payload: result,
    sendResult: result,
  };
}

export async function executePollAction(params: {
  ctx: OutboundSendContext;
  to: string;
  question: string;
  options: string[];
  maxSelections: number;
  durationSeconds?: number;
  durationHours?: number;
  threadId?: string;
  isAnonymous?: boolean;
}): Promise<{
  handledBy: "plugin" | "core";
  payload: unknown;
  toolResult?: AgentToolResult<unknown>;
  pollResult?: MessagePollResult;
}> {
  const pluginHandled = await tryHandleWithPluginAction({
    ctx: params.ctx,
    action: "poll",
  });
  if (pluginHandled) {
    return pluginHandled;
  }

  const result: MessagePollResult = await sendPoll({
    cfg: params.ctx.cfg,
    to: params.to,
    question: params.question,
    options: params.options,
    maxSelections: params.maxSelections,
    durationSeconds: params.durationSeconds ?? undefined,
    durationHours: params.durationHours ?? undefined,
    channel: params.ctx.channel,
    accountId: params.ctx.accountId ?? undefined,
    threadId: params.threadId ?? undefined,
    silent: params.ctx.silent ?? undefined,
    isAnonymous: params.isAnonymous ?? undefined,
    dryRun: params.ctx.dryRun,
    gateway: params.ctx.gateway,
  });

  return {
    handledBy: "core",
    payload: result,
    pollResult: result,
  };
}
