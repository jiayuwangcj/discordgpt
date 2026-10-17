import fs from "node:fs/promises";
import path from "node:path";
import { StateStore, type ManagedTopic } from "./state.js";
import { loadWorkspaces } from "./workspaces.js";

/** Only the trusted host configuration can provision paths and topic bindings. */
export class WorkspaceReloader {
  current: Record<string, string>;
  private pending?: Promise<void>;
  private lastError?: string;
  private applied?: string;
  status: { at?: string; error?: string; topics?: string[] } = {};

  constructor(private readonly options: {
    projectDir: string; workspacesFile?: string; stateDir: string;
    allowedUsers: Set<string>; allowedChannels: Set<string>;
  }, private readonly state: StateStore, private readonly report: (event: string, fields: object) => void) {
    this.current = { default: options.projectDir };
  }

  refresh(): Promise<void> {
    // Polling and incoming messages share one reload; a malformed update must
    // never prevent existing windows (including STOP controls) from working.
    if (!this.pending) this.pending = this.reload().catch((error) => {
      const message = error instanceof Error ? error.message : "Workspace reload failed";
      this.status = { ...this.status, error: message };
      if (message !== this.lastError) this.report("workspace.reload.failed", { error: message });
      this.lastError = message;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async reload(): Promise<void> {
    const next = await loadWorkspaces(this.options.projectDir, this.options.workspacesFile);
    for (const [alias, cwd] of Object.entries(this.current)) {
      if (next[alias] !== cwd) throw new Error("Hot reload only adds workspaces; existing paths cannot change");
    }
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(path.join(this.options.stateDir, "topic-bindings.json"), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      raw = [];
    }
    if (!Array.isArray(raw)) throw new Error("Topic bindings must be an array");
    const topics: ManagedTopic[] = [];
    const seen = new Set<string>();
    for (const value of raw) {
      if (!value || typeof value !== "object" || Array.isArray(value)
        || ["id", "parentId", "guildId", "ownerId"].some((key) => typeof value[key] !== "string" || !/^\d{1,20}$/.test(value[key]))
        || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100
        || typeof value.workspace !== "string" || !Object.hasOwn(next, value.workspace)
        || !this.options.allowedUsers.has(value.ownerId)
        || this.options.allowedChannels.size > 0 && !this.options.allowedChannels.has(value.parentId)
        || seen.has(value.id)) throw new Error("Invalid or unauthorized topic binding");
      seen.add(value.id);
      topics.push({ id: value.id, parentId: value.parentId, guildId: value.guildId, ownerId: value.ownerId, name: value.name, workspace: value.workspace });
    }
    // Persist through the one live StateStore, preserving all thread/model writes.
    await this.state.registerTopics(topics, next);
    this.current = next;
    const fingerprint = JSON.stringify([next, topics]);
    this.status = { at: new Date().toISOString(), topics: topics.map((topic) => topic.id) };
    if (fingerprint !== this.applied || this.lastError) this.report("workspace.reload.applied", { workspaces: Object.keys(next), topics: topics.map((topic) => topic.id) });
    this.applied = fingerprint;
    this.lastError = undefined;
  }
}
