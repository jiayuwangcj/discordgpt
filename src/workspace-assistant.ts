/** Bounded natural-language intents, not arbitrary model-generated shell commands. */
export type ManagementIntent =
  | { kind: "list" }
  | { kind: "help" }
  | { kind: "open" | "create"; query: string; name?: string };

export function parseManagement(text: string): ManagementIntent | undefined {
  const input = text.trim().replace(/[。！!？?]+$/, "");
  if (/^(?:请|帮我)?(?:列出|查看|显示|看看|有哪些|列一下)(?:我(?:的)?|所有|可用)?(?:工作区|话题|项目)(?:和(?:工作区|话题|项目))?$/.test(input)) return { kind: "list" };
  if (/^(?:帮助|怎么用|如何切换(?:工作区|话题)|工作区助手)$/.test(input)) return { kind: "help" };
  const open = /^(?:请|帮我)?(?:打开|切换到|进入|回到)\s*(.+)$/.exec(input);
  if (open) return { kind: "open", query: open[1].trim() };
  const forWorkspace = /^(?:请)?(?:给|为)\s*(.+?)\s*(?:再)?(?:创建|新建|建|开)(?:一个)?(?:独立)?(?:工作区)?话题(.*)$/.exec(input);
  const create = /^(?:请|帮我)?(?:创建|新建|再建|开)(?:一个)?\s*(.+)$/.exec(input);
  if (!create && !forWorkspace) return undefined;
  const body = (forWorkspace?.[1] ?? create![1]).trim();
  const named = /^(.*?)(?:，|,|\s)*(?:叫做|叫|命名为|名字是)\s*(.+)$/.exec(body);
  const trailing = /(?:，|,)?\s*(?:叫做|叫|命名为|名字是)\s*(.+)$/.exec(input);
  return { kind: "create", query: (named?.[1] ?? body).replace(/(?:的)?(?:独立)?(?:工作区)?话题$/, "").trim(),
    name: (named?.[2] ?? trailing?.[1])?.trim() };
}

export type TopicEntry = { id: string; name: string; workspace: string };
export type WorkspaceTools = {
  workspaces(): string[];
  topics(): TopicEntry[];
  create(workspace: string, name: string): Promise<TopicEntry>;
  open(topic: TopicEntry): Promise<void>;
};

export function matchWorkspace(query: string, aliases: string[]): string[] {
  const synonyms: Record<string, string[]> = { discordgpt: ["聊天机器人", "聊天机器人项目"], wbot: ["交易项目", "交易机器人"] };
  return aliases.filter((alias) => {
    const targets = [alias, ...(synonyms[alias] ?? [])];
    return targets.some((target) => {
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-zA-Z0-9_-])${escaped}(?:$|[^a-zA-Z0-9_-])`, "i").test(query);
    });
  });
}

export const managementHelp = "可以说：『列出我的工作区和话题』『打开 wbot』『给 wbot 开一个话题，叫交易开发』『再建一个 wbot 话题』。管理只选择已配置目录，不支持自然语言删除或重置。";

export class WorkspaceAssistant {
  private pending = new Map<string, { intent: ManagementIntent; expires: number }>();

  async respond(key: string, text: string, tools: WorkspaceTools): Promise<string | undefined> {
    for (const [pendingKey, value] of this.pending) if (value.expires <= Date.now()) this.pending.delete(pendingKey);
    if (this.pending.size > 256) this.pending.delete(this.pending.keys().next().value!);
    const previous = this.pending.get(key);
    this.pending.delete(key);
    let intent = parseManagement(text);
    if (!intent && previous && previous.expires > Date.now()) {
      if (/^(取消|算了)$/.test(text.trim())) return "已取消。";
      if ((previous.intent.kind === "create" || previous.intent.kind === "open") && tools.workspaces().includes(text.trim())) {
        intent = { ...previous.intent, query: text.trim() };
      }
    }
    if (!intent) return undefined;
    if (intent.kind === "help") return managementHelp;
    const topics = tools.topics();
    if (intent.kind === "list") {
      return [`工作区：${tools.workspaces().join("、")}`, "当前主频道下你的话题：",
        ...topics.map((topic) => `<#${topic.id}> · ${topic.workspace} · ${topic.name}`),
        ...(topics.length ? [] : ["尚无已登记话题。说『打开 工作区代号』即可创建入口。"])].join("\n");
    }
    // An exact workspace alias selects the workspace, not a coincidentally named topic.
    const request = intent;
    const isAlias = tools.workspaces().some((alias) => alias.toLowerCase() === request.query.toLowerCase());
    const named = request.kind === "open" && !isAlias ? topics.filter((topic) => topic.name === request.query) : [];
    const matches = matchWorkspace(intent.query, tools.workspaces());
    if (!named.length && matches.length !== 1) {
      this.pending.set(key, { intent, expires: Date.now() + 5 * 60_000 });
      return `请明确选择一个工作区：${tools.workspaces().join("、")}。可以直接回复代号；不会猜目录。`;
    }
    const workspace = matches[0];
    const existing = named.length ? named : topics.filter((topic) => topic.workspace === workspace &&
      (request.kind === "open" || !request.name || topic.name === request.name));
    if (intent.kind === "open" && existing.length) {
      if (existing.length > 1) return `请选择话题：\n${existing.map((topic) => `<#${topic.id}> · ${topic.name}`).join("\n")}`;
      await tools.open(existing[0]);
      return `打开话题 <#${existing[0].id}> · 工作区：${existing[0].workspace}。进入后直接聊天。`;
    }
    if (intent.kind === "create" && intent.name && existing.length) {
      return `同名话题已存在：<#${existing[0].id}>。需要独立新上下文时，请换一个话题名。`;
    }
    const name = intent.name || workspace;
    if (name.length > 100) return "话题名称不能超过 100 个字符，请换一个短名称。";
    const topic = await tools.create(workspace, name);
    return `已创建话题 <#${topic.id}> · 工作区：${topic.workspace}。进入后直接聊天，上下文独立。`;
  }
}
