import fs from "node:fs/promises";
import path from "node:path";

/** Metadata only: no prompts, responses, credentials or third-party payloads. */
export class AuditLog {
  private tail = Promise.resolve();
  constructor(private dir: string, private maxBytes = 5 * 1024 * 1024) {}
  append(event: string, fields: Record<string, string | number | boolean | undefined> = {}): Promise<void> {
    const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => /^(channelId|userId|messageId|threadId|turnId|model|effort|status|count|action)$/.test(key)));
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...safe }) + "\n";
    const work = this.tail.then(async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const file = path.join(this.dir, "audit.jsonl");
      const size = await fs.stat(file).then((s) => s.size).catch((e) => { if (e.code === "ENOENT") return 0; throw e; });
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        await fs.rm(file + ".1", { force: true }); await fs.rename(file, file + ".1");
      }
      await fs.appendFile(file, line, { mode: 0o600 });
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
}
