/** Bounded replay protection for Gateway reconnects; matches the legacy one-hour window. */
export class RecentRequests {
  private seen = new Map<string, number>();
  constructor(private limit = 2048, private ttlMs = 60 * 60_000, private now = Date.now) {}
  claim(id: string): boolean {
    if (!id) return false;
    const now = this.now();
    for (const [key, at] of this.seen) {
      if (now - at <= this.ttlMs) break;
      this.seen.delete(key);
    }
    if (this.seen.has(id)) return false;
    if (this.seen.size >= this.limit) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(id, now); return true;
  }
}
