export const SYSTEM_PREFIX = "【系统消息】";
export function systemMessage(text: string): string { return `${SYSTEM_PREFIX} ${text}`; }

export class LifecycleNotifier {
  private readySent = false;
  constructor(private users: Set<string>, private send: (userId: string, text: string) => Promise<void>,
    private log: (text: string) => void = console.error) {}
  async notify(text: string): Promise<void> {
    await Promise.all([...this.users].map(async (id) => {
      try { await this.send(id, systemMessage(text)); }
      catch { this.log(`Lifecycle notification failed for user ${id}`); }
    }));
  }
  async ready(): Promise<void> {
    if (this.readySent) return;
    this.readySent = true;
    await this.notify("discordgpt 已上线，Discord 与 Codex 连接正常。各聊天窗口恢复原有上下文。");
  }
}

export function startHeartbeat(send: (text: string) => Promise<void>, intervalMs = 15 * 60_000): () => void {
  const start = Date.now();
  let stopped = false;
  let sending = false;
  const timer = setInterval(() => {
    if (stopped || sending) return;
    sending = true;
    void send(systemMessage(`长任务仍在处理中，服务正常运行；已持续 ${Math.floor((Date.now() - start) / 60_000)} 分钟，完成后发送最终结果。`))
      .catch(() => undefined).finally(() => { sending = false; });
  }, intervalMs);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
