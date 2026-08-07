import fs from "node:fs/promises";
import path from "node:path";

type StateData = { threads: Record<string, string> };

export class StateStore {
  private data: StateData = { threads: {} };
  private readonly file: string;

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

  async set(channelId: string, threadId: string): Promise<void> {
    this.data.threads[channelId] = threadId;
    await this.save();
  }

  async reset(channelId: string): Promise<void> {
    delete this.data.threads[channelId];
    await this.save();
  }

  private async save(): Promise<void> {
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.file);
    await fs.chmod(this.file, 0o600);
  }
}
