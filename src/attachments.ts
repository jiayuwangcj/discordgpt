import fs from "node:fs/promises";
import path from "node:path";
import type { TurnInput } from "./codex-app-server.js";

type DiscordAttachment = { name: string | null; url: string; contentType: string | null; size: number };
export type PreparedInput = { input: TurnInput[]; cleanup: () => Promise<void> };

const IMAGE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function prepareTurnInput(
  prompt: string,
  attachments: Iterable<DiscordAttachment>,
  stateDir: string,
  messageId: string,
): Promise<PreparedInput> {
  const all = [...attachments];
  const tempDir = path.join(stateDir, "attachments", sanitize(messageId));
  const input: TurnInput[] = [];
  const lines = prompt ? [prompt] : ["The user sent Discord attachments without additional text."];
  if (all.length) lines.push("", "Discord attachments:");
  let created = false;
  for (const [index, attachment] of all.entries()) {
    const label = attachment.name || `attachment-${index + 1}`;
    const contentType = String(attachment.contentType ?? "").split(";", 1)[0].toLowerCase();
    if (IMAGE_TYPES.has(contentType) && attachment.size <= MAX_IMAGE_BYTES && isDiscordCdnUrl(attachment.url)) {
      if (!created) { await fs.mkdir(tempDir, { recursive: true }); created = true; }
      const extension = extensionFor(contentType);
      const localPath = path.join(tempDir, `${index + 1}-${sanitize(path.parse(label).name)}${extension}`);
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Could not download Discord image ${label}: HTTP ${response.status}`);
      const receivedType = String(response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
      if (!IMAGE_TYPES.has(receivedType)) throw new Error(`Discord image ${label} returned unsupported type ${receivedType || "unknown"}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`Discord image ${label} exceeds 20 MiB`);
      await fs.writeFile(localPath, buffer, { mode: 0o600 });
      lines.push(`${index + 1}. image ${label} (${contentType}), attached as localImage`);
      input.push({ type: "localImage", path: localPath });
    } else {
      lines.push(`${index + 1}. ${label}: ${attachment.url}`);
    }
  }
  input.unshift({ type: "text", text: lines.join("\n").trim(), text_elements: [] });
  return {
    input,
    cleanup: async () => { if (created) await fs.rm(tempDir, { recursive: true, force: true }); },
  };
}

function isDiscordCdnUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && IMAGE_HOSTS.has(url.hostname);
  } catch { return false; }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").slice(0, 100) || "item";
}

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  return ".png";
}
