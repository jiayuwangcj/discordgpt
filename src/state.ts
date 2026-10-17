import fs from "node:fs/promises";
import path from "node:path";

export type WorkspaceBinding = { workspace: string; cwd: string };
export type ManagedTopic = { id: string; parentId: string; guildId: string; ownerId: string; name: string; workspace: string };
export type ModelSettings = { model: string; effort?: string };
type StateData = {
  threads: Record<string, string>;
  workspaces?: Record<string, WorkspaceBinding>;
  managedTopics?: Record<string, ManagedTopic>;
  settings?: Record<string, ModelSettings>;
  linkedThreads?: Record<string, boolean>;
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
  threadCount(): number { return Object.keys(this.data.threads).length; }

  isLinkedThread(threadId: string): boolean { return this.data.linkedThreads?.[threadId] === true; }

  async attach(channelId: string, threadId: string, settings?: ModelSettings): Promise<void> {
    const previousThread = this.data.threads[channelId];
    const wasLinked = this.isLinkedThread(threadId);
    const key = `thread:${threadId}`;
    const previousSettings = this.data.settings?.[key];
    const localSettings = Object.entries(this.data.threads).filter(([, id]) => id === threadId)
      .map(([channel]) => this.data.settings?.[channel]).find((value) => value !== undefined);
    const nextSettings = localSettings ?? settings;
    this.data.threads[channelId] = threadId;
    this.data.linkedThreads ??= {};
    this.data.linkedThreads[threadId] = true;
    this.data.settings ??= {};
    // An already-linked thread has one shared model setting; another attachment
    // must not overwrite it with a stale setting from a different window.
    if (!previousSettings && nextSettings) this.data.settings[key] = { ...nextSettings };
    try { await this.save(); }
    catch (error) {
      if (previousThread) this.data.threads[channelId] = previousThread;
      else delete this.data.threads[channelId];
      if (!wasLinked) delete this.data.linkedThreads[threadId];
      if (!previousSettings && nextSettings) delete this.data.settings[key];
      throw error;
    }
  }

  settings(key: string): ModelSettings | undefined {
    const value = this.data.settings?.[key];
    return value ? { ...value } : undefined;
  }

  async setSettings(key: string, settings: ModelSettings): Promise<void> {
    const previous = this.data.settings?.[key];
    this.data.settings ??= {};
    this.data.settings[key] = { ...settings };
    try { await this.save(); }
    catch (error) {
      if (previous) this.data.settings[key] = previous;
      else delete this.data.settings[key];
      throw error;
    }
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

  /** Add host-provisioned topics without reloading or replacing live conversation state. */
  async registerTopics(topics: ManagedTopic[], workspaces: Record<string, string>): Promise<boolean> {
    const additions = topics.filter((topic) => !this.data.managedTopics?.[topic.id] || !this.binding(topic.id));
    for (const topic of topics) {
      const binding = this.binding(topic.id);
      const previous = this.data.managedTopics?.[topic.id];
      if (!Object.hasOwn(workspaces, topic.workspace)
        || binding && (binding.workspace !== topic.workspace || binding.cwd !== workspaces[topic.workspace])
        || previous && (Object.keys(topic) as (keyof ManagedTopic)[]).some((key) => previous[key] !== topic[key])) {
        throw new Error("Conflicting topic binding; existing topics are immutable");
      }
    }
    if (!additions.length) return false;
    this.data.workspaces ??= {};
    this.data.managedTopics ??= {};
    const previous = additions.map((topic) => ({ id: topic.id, binding: this.data.workspaces![topic.id], topic: this.data.managedTopics![topic.id] }));
    for (const topic of additions) {
      this.data.workspaces[topic.id] = { workspace: topic.workspace, cwd: workspaces[topic.workspace] };
      this.data.managedTopics[topic.id] = { ...topic };
    }
    try { await this.save(); }
    catch (error) {
      for (const value of previous) {
        if (value.binding) this.data.workspaces[value.id] = value.binding;
        else delete this.data.workspaces[value.id];
        if (value.topic) this.data.managedTopics[value.id] = value.topic;
        else delete this.data.managedTopics[value.id];
      }
      throw error;
    }
    return true;
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
    const threadId = this.get(channelId);
    const previousSettings = this.data.settings?.[channelId];
    const settings = threadId && this.isLinkedThread(threadId) ? this.settings(`thread:${threadId}`) : undefined;
    if (settings) { this.data.settings ??= {}; this.data.settings[channelId] = settings; }
    delete this.data.threads[channelId];
    try { await this.save(); }
    catch (error) {
      if (threadId) this.data.threads[channelId] = threadId;
      if (settings) {
        if (previousSettings) this.data.settings![channelId] = previousSettings;
        else delete this.data.settings![channelId];
      }
      throw error;
    }
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
