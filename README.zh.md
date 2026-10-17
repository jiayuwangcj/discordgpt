# discordgpt

通过 Discord 控制持久化的 OpenAI Codex 会话。主频道、工作区话题和私信频道的普通消息都交给 Codex 大模型；每个频道对应一个持久 Codex thread，同频道任务串行执行，并可从终端连接同一个本地 app-server。

本项目已从 `wbot` 独立：不包含交易、行情、数据库或正式推送频道逻辑。迁移范围和后续工作见 [MIGRATION.md](MIGRATION.md)，开源方案比较与来源说明见 [UPSTREAM.md](UPSTREAM.md)。

当前代码版本为 **v0.4.7**，新增工作区和已有话题绑定可热加载，无需等待其他会话空闲。线上版本以 systemd 工作目录及发布记录为准。已撤回用频道名显示限额的方案，模型、限额和工作状态保留在话题内的任务卡。原会话绑定保留，线上权限为 `danger-full-access / never`。部署、恢复和真实私聊验收步骤见 [OPERATIONS.md](OPERATIONS.md)，验证记录见 [CHANGELOG.md](CHANGELOG.md)。

默认只在任务完成后统一回复。`DISCORD_PROGRESS_ENABLED=true` 可打开工具执行前的进度消息。停止和状态指令立即执行，不会排在长任务后面；同频道任务串行，不同频道可并行，显式绑定同一 shared thread 的频道共用队列。

每个请求在自己的话题或私聊显示任务状态卡：排队、工作中、额度暂停、结束或失败。执行期间每 7 秒续发 Discord“正在输入”提示；请求结束后停止续发并移除卡片按钮。关闭进度消息不影响这些状态提示，状态发送失败也不会使 Codex 任务失败。

手机话题顶部，话题名下方的一行是 Discord 内置的父频道名称，机器人不能把它当作独立状态栏隐藏或定制。已移除自动改名方案；模型、限额和工作状态在任务卡及 `/status`、`/usage` 中显示。现有话题依附父频道，移除状态展示不会删除频道或聊天记录。

各话题的模型／推理强度、工作状态和限额放在该请求的状态卡中。运行任务的模型固定显示实际启动时使用的模型，切换模型只改变下一轮及待执行请求，避免多话题模型互相冒充。

这是 `claude-code-discord-multibot` 思路的 Codex 原生实现。它不依赖 Claude Discord plugin，而是直接使用：

- Discord Gateway（`discord.js`）接收和发送消息
- `codex app-server` JSON-RPC 驱动本地 Codex
- Codex thread 保存对话上下文
- Codex sandbox 限制文件访问

## 当前功能

- 私信和服务器频道消息
- Discord 原生私人话题绑定独立工作区和 Codex 上下文，私聊保持原有独立会话
- 服务器内默认必须 `@bot`
- Discord 用户和频道 allowlist
- 每个 Discord channel 独立持久 thread
- 同一 channel 的任务自动排队，避免并发写文件
- 新建和绑定会话默认 YOLO：`danger-full-access`＋`never`，可显式配置受限模式
- `!codex status`、`!codex stop`、`!codex reset`
- 按需读取当前频道最近 1–100 条历史消息；默认不会读取
- 附件 URL 会加入任务上下文
- 超过 Discord 消息长度的回复自动分段
- Discord 在线状态栏：显示任务、模型和用量，有 Slurm 任务时保留剩余时间，不显示主机名和项目名

## 工作区话题

主频道、私聊和已绑定工作区的话题都支持直接向 Codex 大模型发送任务，包括工程开发和管理任务。主频道默认需要 @机器人，私聊和已绑定话题不需要。已移除通过规则解析中文请求的管理助手，普通消息和显式历史读取请求不会再被管理入口拦截。

工作区话题创建仍使用 `!codex topic <工作区代号> [话题名]`，`!codex workspaces` 可在私聊或服务器频道列出已配置目录。创建 Discord 话题需要在服务器文字频道执行。私聊支持 `status`、`stop`、`reset`、`history`，不会受服务器频道白名单限制；用户白名单、文件沙箱和主机配置仍然生效。

在主机上配置工作区代号，路径必须是已存在的绝对目录。例如将下面的 JSON 保存到仓库外的 `~/.config/discordgpt/workspaces.json`，权限设为 `0600`：

```json
{
  "wbot": "/absolute/path/to/wbot",
  "discordgpt": "/absolute/path/to/discordgpt"
}
```

配置 `CODEX_WORKSPACES_FILE` 指向该文件。`default` 始终对应 `CODEX_PROJECT_DIR`，新增工作区自动热加载，无需等待其他任务结束或重启服务。聊天端不能指定任意目录。

在允许的服务器文字频道中发送：

```text
@机器人 !codex workspaces
@机器人 !codex topic wbot 交易开发
@机器人 !codex topic discordgpt 聊天开发
```

机器人创建私人话题并添加发起人；进入话题直接聊天，无需再次 @。切换 Discord 话题就是切换工作区和上下文。同一个工作区可创建多个话题，各自拥有独立 Codex thread。话题改名不改变目录，`reset` 只清空当前话题的 Codex 绑定，保留工作区。重启后绑定仍保留；已移除或迁移的目录配置会阻止旧话题执行，不会静默转到其他目录。

机器人在父频道需要 View Channel、Send Messages、Read Message History、Create Private Threads、Send Messages in Threads、Manage Threads；不需要 Administrator。私人话题仍可被具有 Manage Threads 权限的服务器成员查看，不等同于端到端隐私。若设置频道白名单，已绑定话题继承父频道的允许状态，私聊不受频道白名单限制，仍校验用户白名单。

私聊保持原有默认工作目录和独立上下文；只有显式绑定同一个 Codex 会话才会共享上下文。`CODEX_SHARED_THREAD_ID` 为未绑定工作区的窗口提供默认共享会话，显式 `/bind` 优先。已有私人话题可通过 `scripts/bind-workspace-topic.mjs` 热加载绑定，操作见 [OPERATIONS.md](OPERATIONS.md#hot-loading-workspace-topics)。未绑定话题会明确提示消息未入队，绑定启用后需要重新发送。上下文隔离不是文件系统隔离：同工作区话题仍能访问相同工程文件，多个修改任务应使用独立 worktree。

## 继续已有 Codex 会话

无需先发任务或创建新的 Codex 会话：在当前窗口使用 `/sessions` 查看当前工程最近更新的已有会话，或 `/sessions query:关键词` 按标题搜索。使用 `/bind` 的 `thread` 输入框搜索标题，从候选项中选择之前讨论的会话，也可以直接输入完整 thread ID。选择后，下一条普通消息继续原来的 Codex 上下文。候选项显示标题、更新时间和 ID 前缀；列表提供完整 ID 和下一页游标。

私信也支持 `!codex sessions [标题关键词]`、`!codex sessions [关键词] --cursor <游标>` 和 `!codex bind <完整 thread ID>`。服务器中使用原生 slash 命令，历史会话列表和选择结果仅本人可见，文字命令不会公开历史会话标题。

只列出当前工程、当前 Codex 后端可访问的非归档持久会话；`/bind` 还会检查工程目录和运行状态。其他工程的会话应在对应工作区话题内绑定。当前窗口或目标会话有执行、排队、额度暂停任务时不能换绑；恢复或保存失败保留当前绑定。绑定会恢复原会话的模型设置，但仍使用服务配置的 sandbox 和审批策略。

多个窗口显式绑定同一个会话时，共用上下文、串行队列和模型设置，任务控制仍只作用于本人在当前窗口提交的任务。绑定持久化到 `state.json`，重启后保留。`/reset` 只解除当前窗口绑定，不删除原 Codex 会话，也不解除其他窗口的绑定；原会话仍可再次选择。默认共享会话已配置的窗口解除显式绑定后回到该默认会话。

## 权限配置

新建会话、`/bind` 恢复已有会话和直接启动模式默认使用 YOLO：

1. `DISCORD_ALLOWED_USER_IDS` 默认必须显式填写；空值不会允许任何用户。
2. 默认 `CODEX_SANDBOX=danger-full-access`，不设置 Codex 文件与网络沙箱限制；实际能力受服务进程的宿主机权限约束。
3. 默认 `CODEX_APPROVAL_POLICY=never`，执行时不等待审批。
4. 实例显式配置优先；需要限制时可设置 `workspace-write` 或 `read-only`。已有实例配置中的 `workspace-write` 不会因代码默认值变化自动消失。升级脚本的 `--yolo` 参数会显式把该实例切换为 YOLO，并在发布失败时恢复旧配置。
5. bot token 只放在 `.env`，不要提交 Git。

## 准备 Discord bot

在 <https://discord.com/developers/applications>：

1. 创建 Application 和 Bot，复制 token。
2. 打开 **Message Content Intent**。
3. OAuth2 URL Generator 勾选 `bot`。
4. 最小权限：View Channels、Send Messages、Read Message History、Attach Files。
5. 邀请 bot 到自己的服务器；不要授予 Administrator。

在 Discord 设置中打开 Developer Mode，右键自己的用户和目标频道，复制 ID。

## 安装与启动

要求 Node.js 20+、Codex CLI，并且已经完成 `codex login`。

```bash
cd discordgpt
npm ci
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
DISCORD_BOT_TOKEN=你的_token
CODEX_PROJECT_DIR=/绝对路径/到/项目
DISCORD_ALLOWED_USER_IDS=你的_Discord_用户_ID
DISCORD_ALLOWED_CHANNEL_IDS=目标频道_ID
```

然后：

```bash
npm run build
npm start
```

## `claude-dc` 风格的直接启动函数

仓库提供 [codex-dc.bash](codex-dc.bash)，但不会自动修改 `.bashrc`。在测试阶段可以只对当前 shell 临时加载：

```bash
source "$PWD/codex-dc.bash"
```

在目标项目目录初始化并启动：

```bash
cd /path/to/project
codex-dc-init
codex-dc
```

`codex-dc` 会在后台启动本机 app-server 和该项目的 Discord bridge，然后当前终端直接进入共享 thread 的 Codex TUI。退出这个 TUI 后，后台 bridge 和 app-server 一并停止，行为与 `claude-dc` 接近。

普通文本生成期间，bridge 会缓存 Codex 的 `commentary`；仅在工具、命令或文件修改即将开始前，把此前累计内容作为一条 `⏳` 消息发到 Discord。工具结束后重新缓存，最终答案完整独立发送。时间、字符数、标点和换行均不会自行触发中间消息。

Discord 的 PNG、JPEG 和 WebP 图片附件会从 Discord CDN 受限下载（单张最多 20 MiB），作为 Codex app-server 的 `localImage` 输入，因此 Codex 可以直接识别截图。临时图片在 turn 结束后自动删除；其他附件仍以 URL 和文件名作为文本上下文。

Bot presence 显示任务数量、剩余用量和执行中模型，不显示主机名或工程名。Slurm 环境还会显示 `⏳6d19h` 这类剩余时间，由当前进程的 `SLURM_JOB_ID` 异步查询 `squeue %L`。绿点表示当前在线，任务执行时显示忙碌状态；进程或 allocation 结束后会自动变灰。

启动时显示“限额：读取中”，连接完成、重连恢复及任务阶段变化时同步完整状态；每 30 秒再次同步，账户用量仍按五分钟周期读取。快速变化会合并为最新状态，发布间隔至少五秒。`health.json` 的 `presence` 字段记录最近提交给 Gateway 的文字、在线状态和时间，不代表 Discord 客户端已经显示。

可用函数：

- `codex-dc`：启动/恢复当前目录的主 bot 和共享 Codex TUI。
- `codex-dc-init`：创建独立 bot 配置，交互读取 token、用户 ID、频道 ID和 localhost 端口。
- `codex-dc-alt [N]`：启动同项目的第 N 个独立 bot，默认 N=2。
- `codex-dc-init N`：初始化 alt-N 的配置。
- `codex-dc-allow USER_IDS [CHANNEL_IDS] [N]`：修改 allowlist。
- `codex-dc-status [N]`：显示 thread、app-server/bridge PID 和日志位置。

隔离状态布局：

```text
~/codex_home_sandbox/.codex-discord/
├── <project-basename>/
│   ├── instance.env       # token/config, chmod 600
│   ├── thread-id          # TUI 与 Discord 共同恢复的 thread
│   ├── app-server.pid
│   ├── bridge.pid
│   ├── logs/
│   └── runtime/
└── <project-basename>-2/  # alt bot
```

它不会使用 Claude 的 `~/.claude-discord/`，也不会读取 `~/.env`。函数文件目前仅供手动 `source`，本项目不会写入 `.bashrc`。

私信 bot 可以直接发任务；服务器频道内使用：

```text
@your_bot 阅读 README 并总结项目架构
```

## 多项目 / 多 bot

每个 bot 运行一个进程，并使用独立 `.env` 和状态目录。最简单的方式是为实例准备 env 文件：

```text
instances/
├── project-a.env
└── project-b.env
```

分别启动：

```bash
node --env-file=instances/project-a.env dist/index.js
node --env-file=instances/project-b.env dist/index.js
```

每份配置应使用不同的 `DISCORD_BOT_TOKEN`、`CODEX_PROJECT_DIR` 和 `CODEX_DISCORD_STATE_DIR`。不要让两个实例共用状态目录。

## tmux 中观察同一个 Codex job（推荐）

普通模式由 bridge 通过 stdio 独占一个 app-server，tmux 只能看到 bridge 日志。共享模式让 Discord bridge 和 Codex TUI 连接同一个本地 WebSocket app-server：

```text
Discord bridge ─┐
                ├── codex app-server ws://127.0.0.1:4500
tmux Codex TUI ─┘
```

先准备一份显式实例配置；不要使用 `~/.env`：

```bash
cp instances/project.env.example instances/my-project.env
chmod 600 instances/my-project.env
# 编辑 token、Discord ID、项目路径、状态路径和端口
```

编译并启动三窗格 tmux：

```bash
npm run build
./scripts/start-shared-tmux.sh "$PWD/instances/my-project.env" my-project-codex
tmux attach -t my-project-codex
```

三个窗格分别是：

1. Codex app-server 日志
2. Discord bridge 日志
3. 用于附着 Codex TUI 的 shell

第一次从 Discord 发消息后，用 `!codex status` 取得 thread ID，然后在第三个窗格运行：

```bash
./scripts/attach-thread.sh <THREAD_ID> "$PWD/instances/my-project.env"
```

该命令实际使用 `codex resume --remote ... <THREAD_ID>`。TUI 和 Discord bridge 会订阅同一个 thread，因此能看到同一个 turn、工具调用和 job 状态，也可以在 TUI 中继续操作。

### 配置隔离保证

- 程序只读取显式传给脚本的实例 env；普通 `npm start` 只读取本仓库的 `.env`。
- 不会搜索、读取或 source `~/.env`。
- 不会修改 `~/.claude/`。
- Codex 自身仍正常使用它自己的 `~/.codex` 登录和会话状态；本项目不会重写该目录。
- 每个 bot 必须使用不同的 `CODEX_DISCORD_STATE_DIR` 和 WebSocket 端口。

WebSocket 默认只允许 `ws://127.0.0.1:*` 或 `ws://localhost:*`。不要把未认证的 app-server 监听到 HPC 的外网或共享网卡上。

## 命令

- `!codex status`：显示当前 channel 的 thread 和运行状态
- `!codex stop`：中断当前 turn
- `!codex reset`：忘记当前 channel 的 thread；下一条消息建立新 thread
- `!codex help`：显示命令帮助
- `!codex history [条数] [任务]`：明确授权读取当前频道最近的历史消息，并交给 Codex 处理；默认 20 条，最高 100 条

例如：

```text
@your_bot !codex history 30 总结我们刚才讨论出的决定和待办事项
```

历史读取只会在发送该命令时发生，并仍受用户与频道 allowlist 限制。

服务器频道中的命令同样需要 `@bot`，例如 `@bot !codex status`。

## 与 Claude 版本的差异

| 项目 | Claude 版本 | Codex 版本 |
| --- | --- | --- |
| Discord 接入 | 官方 Claude channel plugin | 自建 `discord.js` bridge |
| 会话 | Claude Code session | Codex app-server thread |
| 状态隔离 | `DISCORD_STATE_DIR` | 每实例 env + `.state/state.json` |
| 配对 | plugin pairing code | Discord user/channel allowlist |
| 权限 | Claude permission flow | Codex sandbox + approval policy |

## 已知限制

- MVP 暂不在 Discord 中提供交互式审批；越权请求一律拒绝。
- `stop` 只能中断正在执行的 turn，已排队消息仍会继续执行。
- PNG/JPEG/WebP 会下载为本地多模态输入，其他附件使用 URL；下载有体积上限，turn 完成后清理。
- app-server 接口由已安装 Codex CLI 提供；升级 Codex 后应重新运行测试。
- TUI 需要先知道 Discord channel 对应的 thread ID；目前通过 `!codex status` 后运行 attach 脚本完成，尚未自动切换。
- 任务队列仅保存在内存；进程重启后需重发未完成任务。会话绑定保持持久化。
- writer 冲突或 resume 失败不会自动新建会话；排查后重试，或显式 reset。
- 动态模型/推理强度、账号用量、系统通知、队列控制和 JSONL 审计已补齐到 v0.4.0 候选代码；完整功能对照和待完成的线上验收见 [FEATURE_PARITY.md](FEATURE_PARITY.md)。

## 实验性微信 ClawBot 桥接

仓库另带一个独立的微信入口，用腾讯公开的 iLink/ClawBot 协议把微信私聊连接到同一个 Codex app-server。它不会启动 OpenClaw，也不会影响 Discord bridge。

当前范围：

- 微信 ClawBot 一对一私聊（官方通道当前不支持微信群）
- 扫码授权，凭据以 `0600` 权限保存在独立 state 目录
- 文字输入输出；语音消息有微信转写文字时也可作为输入
- 扫码用户 allowlist
- `CODEX_SHARED_THREAD_ID` 绑定现有 terminal thread
- 长轮询 cursor 持久化与基本重试

准备配置：

```bash
cp instances/weixin.env.example instances/my-weixin.env
chmod 600 instances/my-weixin.env
# 编辑项目路径、state 路径、app-server URL 和共享 thread ID
npm run build
```

首次扫码授权：

```bash
node --env-file=instances/my-weixin.env dist/weixin-login.js
```

启动桥接：

```bash
node --env-file=instances/my-weixin.env dist/weixin-index.js
```

若扫码响应没有返回用户 ID，把首次消息日志中的 `from_user_id` 填入 `WEIXIN_ALLOWED_USER_IDS`。不要提交 state 目录或 credentials 文件，也不要把 app-server WebSocket 暴露到 HPC 外网。

此入口目前是最小实验框架；图片/文件下载、输入状态、聊天命令以及生产级 token 失效恢复尚未实现。协议参考腾讯的 MIT 许可项目 `Tencent/openclaw-weixin`。

## 模型、用量与任务控制

私聊、主频道和已绑定话题均支持 `/model [模型] [强度]`、`/models`、`/status`、`/usage`、`/ps`、`/stop`、`/cancel [消息ID]`、`/steer 新方向`、`/resume`。也可使用对应 `!codex` 命令。模型目录和模型级推理强度来自 app-server；无效设置不会覆盖原值。模型设置按当前会话持久保存，下一轮任务生效；显式共享一个 Codex thread 的窗口共用设置和队列。

额度属于账号，所有聊天窗口共享。读取失败显示上次结果；额度明确耗尽时暂停受影响任务及其后续队列。服务端明确许可后自动继续；`/resume` 可明确请求重试，`/cancel` 可取消暂停请求。不会因其他额度桶用尽而自动阻止所有模型，也不会仅凭重置时间猜测恢复。

上线、正常下线和异常退出通知只发送给授权用户的私聊。任务暂停、恢复、排队和每 15 分钟一次的长任务保活发送到原窗口。队列卡片只允许原用户在原频道操作。`/compact` 和 `/side` 延续旧版的未支持提示；独立上下文可通过 `/topic` 创建。

若 Discord 应用配置了 HTTP 交互入口，斜杠命令和按钮不会经 Gateway 送达。请按 [OPERATIONS.md](OPERATIONS.md) 配置签名验证入口和反向代理，新服务处理聊天控制，其他业务交互转发到原入口。
