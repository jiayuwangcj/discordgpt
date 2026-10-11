/** Serial execution per channel, with failures isolated from later work. */
export class ChannelQueue {
  private tails = new Map<string, Promise<void>>();
  private counts = new Map<string, number>();

  size(key: string): number { return this.counts.get(key) ?? 0; }

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    this.counts.set(key, this.size(key) + 1);
    const run = (this.tails.get(key) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => undefined).finally(() => {
      const remaining = this.size(key) - 1;
      if (remaining) this.counts.set(key, remaining);
      else this.counts.delete(key);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    return run;
  }
}
