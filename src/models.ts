import type { ModelSettings } from "./state.js";

export type CatalogModel = {
  id: string; model: string; displayName: string; isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
};

export class ModelCatalog {
  models: CatalogModel[] = [];
  fetchedAt = 0;
  stale = true;
  private refreshing?: Promise<void>;

  constructor(private read: () => Promise<CatalogModel[]>) {}

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.read().then((models) => {
      if (!models.length || models.some((m) => !m.model || !Array.isArray(m.supportedReasoningEfforts))) {
        throw new Error("模型目录暂不可用，请稍后重试。");
      }
      this.models = models;
      this.fetchedAt = Date.now();
      this.stale = false;
    }).catch((error) => { this.stale = true; throw error; }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  select(name: string, effort: string | undefined, previous?: ModelSettings): ModelSettings {
    if (this.stale) throw new Error("模型目录暂不可用，请稍后重试；原设置保留。");
    const query = name.toLowerCase();
    const exact = this.models.find((m) => m.model.toLowerCase() === query || m.id.toLowerCase() === query);
    const matches = exact ? [exact] : this.models.filter((m) => m.model.toLowerCase().split("-").at(-1) === query);
    if (matches.length !== 1) throw new Error(matches.length ? "模型简称不唯一，请使用完整模型 ID。" : "未知模型，请先查看 /models。");
    const model = matches[0];
    const supported = model.supportedReasoningEfforts.map((e) => e.reasoningEffort);
    const explicit = effort === "mid" ? "medium" : effort;
    if (explicit && !supported.includes(explicit)) throw new Error(`该模型支持的推理强度：${supported.join("、") || "无"}。原设置保留。`);
    const selected = explicit ?? (previous?.effort && supported.includes(previous.effort) ? previous.effort : model.defaultReasoningEffort);
    return { model: model.model, ...(selected && supported.includes(selected) ? { effort: selected } : {}) };
  }

  describe(): string {
    if (!this.models.length) return "模型目录暂不可用，请稍后重试。";
    return [this.stale ? "模型目录（上次读取；暂不能切换）：" : "当前可用模型：",
      ...this.models.map((m) => `${m.model}${m.isDefault ? "（默认）" : ""} · ${m.supportedReasoningEfforts.map((e) => e.reasoningEffort).join("/") || "无推理强度"}`)].join("\n");
  }
}
