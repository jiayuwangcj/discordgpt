import { Collection, Message } from "discord.js";

export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 100;

export function parseHistoryRequest(prompt: string): { limit: number; task: string } | undefined {
  const match = prompt.match(/^!codex\s+history(?:\s+(\d+))?(?:\s+([\s\S]+))?$/i);
  if (!match) return undefined;
  const requested = match[1] ? Number.parseInt(match[1], 10) : DEFAULT_HISTORY_LIMIT;
  const limit = Math.min(Math.max(requested, 1), MAX_HISTORY_LIMIT);
  const task = match[2]?.trim() || "请阅读这些 Discord 聊天记录，并告诉我你已获得哪些相关上下文。";
  return { limit, task };
}

export function formatHistory(messages: Collection<string, Message>, currentMessageId: string): string {
  return [...messages.values()]
    .filter((message) => message.id !== currentMessageId)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => {
      const content = message.content.trim() || "[无文字内容]";
      const attachments = [...message.attachments.values()].map((attachment) => attachment.url);
      const suffix = attachments.length ? `\n附件: ${attachments.join(", ")}` : "";
      return `[${message.createdAt.toISOString()}] ${message.author.tag} (${message.author.id}): ${content}${suffix}`;
    })
    .join("\n");
}

