export class ProgressRelay {
  private buffer = "";
  private chain = Promise.resolve();
  private sentCount = 0;

  constructor(private readonly send: (text: string) => Promise<void>) {}

  push(delta: string, outputKind: "commentary" | "final_answer"): void {
    if (outputKind !== "commentary" || !delta) return;
    this.buffer += delta;
  }

  get hasSent(): boolean {
    return this.sentCount > 0;
  }

  async flushBeforeTool(): Promise<void> {
    this.flush();
    await this.chain;
  }

  async finish(): Promise<void> {
    this.buffer = "";
    await this.chain;
  }

  private flush(): void {
    const text = this.buffer.trim();
    this.buffer = "";
    if (!text) return;
    const chunks = text.match(/[\s\S]{1,1800}/g) ?? [text];
    for (const chunk of chunks) {
      this.chain = this.chain.then(async () => {
        await this.send(`⏳ ${chunk}`);
        this.sentCount += 1;
      }).catch(() => undefined);
    }
  }
}
