import { systemMessage } from "./notifications.js";

export type TaskStatus = "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";
const labels: Record<TaskStatus, string> = {
  queued: "⏳ 任务已排队，等待当前会话的前一个任务结束。",
  running: "🔄 工作中，正在处理当前请求；完成后发送结果。",
  paused: "⏸️ 额度不足，任务已暂停；可 /resume 继续或 /cancel 取消。",
  completed: "✅ 当前请求已结束。",
  cancelled: "⏹️ 当前请求已停止或取消。",
  failed: "❌ 当前请求失败，上下文已保留。",
};
type Card = { id: string; edit: (payload: any) => Promise<unknown> };

/** One in-window card; serialize edits so a delayed REST response cannot revert status. */
export class TaskStatusCard {
  private phase: TaskStatus;
  private terminal = false;
  private details = "";
  private card?: Promise<Card | undefined>;
  private tail: Promise<void> = Promise.resolve();
  constructor(initial: TaskStatus, private create: (content: string) => Promise<Card>,
    private register: (id: string) => void, private log: () => void = () => console.error("Task status delivery failed")) {
    this.phase = initial;
  }
  show(): void {
    if (this.card) return;
    this.card = Promise.resolve().then(() => this.create(this.content()))
      .then((card) => { if (!this.terminal) this.register(card.id); return card; })
      .catch(() => { this.log(); return undefined; });
    // A task may finish while its initial REST message is in flight.
    this.scheduleEdit();
  }
  update(phase: TaskStatus): void {
    if (this.terminal) return;
    this.phase = phase;
    if (this.card) this.scheduleEdit();
  }
  setDetails(details: string): void {
    if (this.terminal || details === this.details) return;
    this.details = details;
    if (this.card) this.scheduleEdit();
  }
  private content(): string { return systemMessage([labels[this.phase], this.details].filter(Boolean).join("\n")); }
  async finish(phase: "completed" | "cancelled" | "failed"): Promise<void> {
    this.phase = phase; this.terminal = true;
    if (this.card) this.scheduleEdit();
    await this.tail;
  }
  private scheduleEdit(): void {
    this.tail = this.tail.then(async () => {
      const card = await this.card;
      if (card) await card.edit({ content: this.content(),
        ...(this.terminal ? { components: [] } : {}), allowedMentions: { parse: [], repliedUser: false } });
    }).catch(() => { this.log(); });
  }
}
