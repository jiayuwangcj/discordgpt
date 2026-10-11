import fs from "node:fs/promises";
import path from "node:path";

export type WorkspaceBinding = { workspace: string; cwd: string };
export type ManagedTopic = { id: string; parentId: string; guildId: string; ownerId: string; name: string; workspace: string };
type StateData = {
  threads: Record<string, string>;
  workspaces?: Record<string, WorkspaceBinding>;
  managedTopics?: Record<string, ManagedTopic>;
};

export class StateStore {
  private data: StateData = { threads: {} };
  private readonly file: string;
  private saveTail: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, "state.json");
  }

  async load(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8")) as StateData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save();
    }
  }

  get(channelId: string): string | undefined {
    return this.data.threads[channelId];
  }

  binding(channelId: string): WorkspaceBinding | undefined {
    const value = this.data.workspaces?.[channelId];
    return value ? { ...value } : undefined;
  }

  topics(parentId: string, ownerId: string): ManagedTopic[] {
    return Object.values(this.data.managedTopics ?? {}).filter((topic) => topic.parentId === parentId && topic.ownerId === ownerId)
      .map((topic) => ({ ...topic }));
  }

  async recordTopic(topic: ManagedTopic): Promise<void> {
    if (!this.binding(topic.id)) throw new Error("Topic must have a workspace binding first");
    this.data.managedTopics ??= {};
    this.data.managedTopics[topic.id] = { ...topic };
    await this.save();
  }

  async bindWorkspace(channelId: string, workspace: string, cwd: string): Promise<void> {
    const existing = this.binding(channelId);
    if (existing && (existing.workspace !== workspace || existing.cwd !== cwd)) throw new Error("Workspace binding is immutable; create a new Discord topic");
    this.data.workspaces ??= {};
    this.data.workspaces[channelId] = { workspace, cwd };
    await this.save();
  }

  async set(channelId: string, threadId: string): Promise<void> {
    this.data.threads[channelId] = threadId;
    await this.save();
  }

  async reset(channelId: string): Promise<void> {
    delete this.data.threads[channelId];
    await this.save();
  }

  private save(): Promise<void> {
    const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
    const run = this.saveTail.then(() => this.writeSnapshot(snapshot));
    this.saveTail = run.catch(() => undefined);
    return run;
  }

  private async writeSnapshot(snapshot: string): Promise<void> {
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, snapshot, { mode: 0o600 });
    await fs.rename(temp, this.file);
    await fs.chmod(this.file, 0o600);
  }
}
