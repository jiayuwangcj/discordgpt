export type TaskPhase = "queued" | "running" | "paused";
export type TaskInfo = { id: string; key: string; channelId: string; userId: string; phase: TaskPhase; startedAt?: number; retry: boolean };
export class QuotaPause extends Error {}
export class TaskAdmissionError extends Error {}
type Entry = TaskInfo & {
  run: (retry: boolean, signal: AbortSignal) => Promise<void>;
  controller: AbortController;
  resolve: () => void; reject: (error: unknown) => void;
  onPhase?: (phase: TaskPhase, retry: boolean) => Promise<void>;
};

/** FIFO per effective Codex thread; controls never wait behind model work. */
export class TaskScheduler {
  private tasks = new Map<string, Entry>();
  private workers = new Set<string>();
  draining = false;
  accepting = true;
  constructor(private maxPerKey = 100) {}
  list(key?: string): TaskInfo[] {
    return [...this.tasks.values()].filter((t) => !key || t.key === key)
      .map(({ id, key, channelId, userId, phase, startedAt, retry }) => ({ id, key, channelId, userId, phase, startedAt, retry }));
  }
  size(key: string): number { return this.list(key).length; }
  enqueue(info: Omit<TaskInfo, "phase" | "retry">, run: Entry["run"], onPhase?: Entry["onPhase"]): Promise<void> {
    if (!this.accepting || this.draining) return Promise.reject(new TaskAdmissionError("服务正在准备重启，请稍后发送任务。"));
    if (this.tasks.has(info.id)) return Promise.reject(new Error("Duplicate task"));
    if (this.size(info.key) >= this.maxPerKey) return Promise.reject(new TaskAdmissionError("当前会话队列已满，请先取消待执行任务。"));
    const result = new Promise<void>((resolve, reject) => {
      this.tasks.set(info.id, { ...info, phase: "queued", retry: false, controller: new AbortController(), run, resolve, reject, onPhase });
    });
    void this.pump(info.key);
    return result;
  }
  cancel(id: string, channelId: string, userId: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.channelId !== channelId || task.userId !== userId || task.phase === "running") return false;
    this.tasks.delete(id); task.resolve(); void this.pump(task.key); return true;
  }
  abortAdmission(id: string, channelId: string, userId: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.channelId !== channelId || task.userId !== userId) return false;
    task.controller.abort(); return true;
  }
  resumePaused(onlyKey?: string, channelId?: string, userId?: string): void {
    const keys = new Set<string>();
    for (const task of this.tasks.values()) if (task.phase === "paused" && (!onlyKey || task.key === onlyKey)
      && (!channelId || task.channelId === channelId) && (!userId || task.userId === userId)) {
      task.phase = "queued"; keys.add(task.key);
    }
    for (const key of keys) void this.pump(key);
  }
  private async pump(key: string): Promise<void> {
    if (this.workers.has(key)) return;
    this.workers.add(key);
    try {
      while (true) {
        const task = [...this.tasks.values()].find((t) => t.key === key);
        if (!task || task.phase === "paused") break;
        task.phase = "running"; task.startedAt = Date.now();
        try {
          try { await task.onPhase?.("running", task.retry); } catch { /* A notice cannot discard admitted work. */ }
          await task.run(task.retry, task.controller.signal);
          this.tasks.delete(task.id); task.resolve();
        } catch (error) {
          if (error instanceof QuotaPause && !task.controller.signal.aborted) {
            task.phase = "paused"; task.retry = true;
            try { await task.onPhase?.("paused", task.retry); } catch { /* Notification failure cannot lose a task. */ }
            break;
          }
          this.tasks.delete(task.id); task.reject(error);
        }
      }
    } finally {
      this.workers.delete(key);
      // Resume/cancel may arrive while the pause notice awaits REST. Recheck
      // after releasing worker ownership so that a queued head cannot stall.
      const head = [...this.tasks.values()].find((task) => task.key === key);
      if (head?.phase === "queued") void this.pump(key);
    }
  }
}
