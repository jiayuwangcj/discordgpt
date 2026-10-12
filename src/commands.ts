import { ApplicationCommandOptionType, ApplicationCommandType, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

export function applicationCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const string = (name: string, description: string, required = false) => ({ name, description, required, type: ApplicationCommandOptionType.String as const });
  const simple = (name: string, description: string) => ({ name, description, type: ApplicationCommandType.ChatInput as const, dm_permission: true });
  return [
    { ...simple("model", "查看或切换当前会话模型与推理强度（下一轮生效）"), options: [
      { ...string("model", "模型完整 ID 或唯一简称"), autocomplete: true },
      { ...string("effort", "所选模型支持的推理强度"), autocomplete: true },
    ] },
    simple("models", "列出 app-server 当前可用模型"),
    simple("status", "当前窗口的模型、目录、任务与账号用量"),
    simple("usage", "账号共享额度、剩余比例与重置时间"),
    simple("ps", "列出当前会话的运行、排队与暂停任务"),
    simple("stop", "中断当前会话任务；空闲时取消最早待执行任务"),
    { ...simple("cancel", "取消当前窗口的排队或暂停任务"), options: [string("id", "任务消息 ID；省略取消最早任务")] },
    { ...simple("steer", "向当前任务补充方向，保持同一 turn"), options: [string("text", "新方向", true)] },
    simple("resume", "明确请求继续额度暂停的任务"),
    simple("compact", "查看上下文压缩支持状态"),
    simple("side", "查看独立话题使用方法"),
    simple("workspaces", "列出已配置的工程目录代号"),
    { ...simple("sessions", "查看当前工程已有 Codex 会话，仅你可见"), options: [string("query", "按会话标题搜索"), string("cursor", "上次列表给出的下一页游标")] },
    { ...simple("bind", "绑定已有 Codex 会话并继续原上下文"), options: [{ ...string("thread", "搜索会话标题，或输入完整 thread ID", true), autocomplete: true }] },
    { ...simple("topic", "在服务器文字频道创建独立工程话题"), options: [string("workspace", "已配置工作区代号", true), string("name", "话题名")] },
    simple("reset", "清空当前窗口 Codex 上下文，保留工程目录"),
    simple("help", "查看聊天与控制命令"),
  ];
}

export const controlHelp = "普通消息直接交给 Codex。控制命令：/model [模型] [强度]、/models、/status、/usage、/ps、/stop、/cancel [消息ID]、/steer 新方向、/resume、/reset、/workspaces、/topic 工作区 [名称]。已有上下文：/sessions [标题]、/bind <会话>（搜索选择或完整 thread ID）。也可使用 !codex <命令>；私信中用 !codex sessions [标题]、!codex bind <thread ID>。历史读取：!codex history [1-100] [任务]。同一 thread 共享队列和模型设置，额度为账号共享。";
