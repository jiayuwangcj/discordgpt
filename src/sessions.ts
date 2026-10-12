export function sessionTitle(thread: { name?: string | null; preview?: string }): string {
  // Keep titles on one line and prevent Markdown/mentions from becoming UI.
  return (thread.name || thread.preview || "未命名会话").replace(/[\r\n\t]+/g, " ")
    .replace(/[@`*_~<>\\]/g, "").trim().slice(0, 80) || "未命名会话";
}

export function sessionDate(thread: { updatedAt?: number }): string {
  return typeof thread.updatedAt === "number" && Number.isFinite(thread.updatedAt)
    && Math.abs(thread.updatedAt) < 8.64e12 ? new Date(thread.updatedAt * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "时间未知";
}

export function sessionChoices(threads: any[]): { name: string; value: string }[] {
  return threads.filter((thread) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(thread.id))
    .slice(0, 25).map((thread) => ({ name: `${sessionTitle(thread).slice(0, 55)} · ${sessionDate(thread)} · ${thread.id.slice(0, 8)}`.slice(0, 100), value: thread.id }));
}

export function sessionList(page: { data: any[]; nextCursor: string | null }): string {
  const lines = page.data.map((thread) => `• ${sessionTitle(thread)} · ${sessionDate(thread)}${thread.status?.type === "active" ? " · 执行中" : ""}\n  \`${thread.id}\``);
  return [lines.length ? "当前工程的已有 Codex 会话（最近更新在前）：" : "当前工程未找到匹配的已有会话。", ...lines,
    page.nextCursor ? `下一页：/sessions cursor:${page.nextCursor}` : "", "使用 /bind 搜索选择，或 !codex bind <完整 thread ID>。不会创建新会话。"].filter(Boolean).join("\n");
}
