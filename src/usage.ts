export type UsageWindow = { usedPercent: number; windowDurationMins?: number; resetsAt?: number };
export type UsageBucket = {
  limitId?: string; limitName?: string; primary?: UsageWindow; secondary?: UsageWindow;
  rateLimitReachedType?: string | null; spendControlReached?: boolean | null;
};
export type UsagePayload = {
  rateLimits?: UsageBucket; rateLimitsByLimitId?: Record<string, UsageBucket> | null;
  ordinaryUsageAllowed?: boolean | null;
};

export function remaining(window: UsageWindow): number | undefined {
  if (!Number.isFinite(window.usedPercent)) return undefined;
  return Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent)));
}
function label(window: UsageWindow): string {
  const mins = window.windowDurationMins;
  return mins === 10080 ? "w" : mins && mins % 60 === 0 ? `${mins / 60}h` : mins ? `${mins}m` : "窗口";
}
export function quotaError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : JSON.stringify(error) ?? "";
  return /usage[_ -]?limit|rate[_ -]?limit|quota[_ -]?(?:exceeded|exhausted)|insufficient[_ -]quota|credits[_ -]depleted|too many requests|(?:http|status)\s*429/i.test(text);
}

export class UsageMonitor {
  payload?: UsagePayload;
  fetchedAt = 0;
  stale = true;
  accountType = "";
  planType = "";
  private refreshing?: Promise<void>;
  constructor(private read: () => Promise<UsagePayload>, private account: () => Promise<any>) {}

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.read().then(async (payload) => {
      if (!payload || (!payload.rateLimits && !payload.rateLimitsByLimitId && typeof payload.ordinaryUsageAllowed !== "boolean")) {
        throw new Error("Usage response unavailable");
      }
      this.payload = payload; this.fetchedAt = Date.now(); this.stale = false;
      try {
        const result = await this.account();
        this.accountType = result.account?.type ?? "";
        this.planType = result.account?.planType ?? "";
      } catch { /* A limits read remains valid if account metadata is unavailable. */ }
    }).catch((error) => { this.stale = true; throw error; }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  // New app-server versions explicitly forbid inferring permission to retry
  // from percentages. Recovery is allowed only by the backend's permission bit.
  canResume(): boolean { return !this.stale && this.payload?.ordinaryUsageAllowed === true; }

  summary(compact = false): string {
    if (!this.payload) return "限额：暂不可用";
    const buckets = this.payload.rateLimitsByLimitId && Object.keys(this.payload.rateLimitsByLimitId).length
      ? Object.entries(this.payload.rateLimitsByLimitId) : [[this.payload.rateLimits?.limitId || "codex", this.payload.rateLimits]] as const;
    const lines: string[] = [];
    for (const [id, bucket] of buckets) {
      if (!bucket) continue;
      const windows = [bucket.primary, bucket.secondary].filter((w): w is UsageWindow => !!w);
      const parts = windows.map((w) => `${label(w)}-${remaining(w) ?? "未知"}%`);
      const prefix = compact && id.toLowerCase() === "codex" ? "" : `${id}: `;
      lines.push(`${prefix}${parts.join(" ") || "暂不可用"}${bucket.rateLimitReachedType ? "（限额已达）" : ""}`);
      if (!compact) for (const w of windows) if (Number.isFinite(w.resetsAt)) {
        lines.push(`${id} ${label(w)} 重置：${new Date(w.resetsAt! * 1000).toISOString()}`);
      }
    }
    const account = [this.accountType, this.planType].filter(Boolean).join(" · ");
    return [!compact && account ? `账户：${account}` : "", `限额：${lines.join(compact ? " · " : "\n") || "暂不可用"}${this.stale ? "（上次读取）" : ""}`,
      !compact && this.fetchedAt ? `读取时间：${new Date(this.fetchedAt).toISOString()}；账号级额度，所有窗口共用。` : ""].filter(Boolean).join("\n");
  }
}
