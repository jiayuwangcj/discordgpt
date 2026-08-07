# codex-discord-multibot

把一个本地 Codex 项目连接到一个专用 Discord bot。每个 Discord 频道或私信频道对应一个持久 Codex thread；多个项目通过运行多个独立实例实现隔离。

这是 `claude-code-discord-multibot` 思路的 Codex 原生实现。它不依赖 Claude Discord plugin，而是直接使用：

- Discord Gateway（`discord.js`）接收和发送消息
- `codex app-server` JSON-RPC 驱动本地 Codex
- Codex thread 保存对话上下文
- Codex sandbox 限制文件访问

## 当前功能

- 私信和服务器频道消息
- 服务器内默认必须 `@bot`
- Discord 用户和频道 allowlist
- 每个 Discord channel 独立持久 thread
- 同一 channel 的任务自动排队，避免并发写文件
- `workspace-write` sandbox，默认不允许任何权限升级
- `!codex status`、`!codex stop`、`!codex reset`
- 按需读取当前频道最近 1–100 条历史消息；默认不会读取
- PNG、JPEG、WebP 图片附件会作为受限的本地多模态输入
- 超过 Discord 消息长度的回复自动分段

## 安全模型

Discord 是一个远程代码执行入口，务必保持最小权限：

1. `DISCORD_ALLOWED_USER_IDS` 默认必须显式填写；空值不会允许任何用户。
2. 默认 `CODEX_SANDBOX=workspace-write`，Codex 只能写指定项目/workspace。
3. 默认 `CODEX_APPROVAL_POLICY=never`，Discord 端不会批准越权请求。
4. 不要使用 `danger-full-access`，除非 bot 运行在一次性隔离 VM/容器中。
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
cd /path/to/codex-chat-bridge/packages/discord-bridge
npm install
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
source /path/to/codex-chat-bridge/packages/discord-bridge/codex-dc.bash
```

在目标项目目录初始化并启动：

```bash
cd /path/to/project
codex-dc-init
codex-dc
```

`codex-dc` 会在后台启动本机 app-server 和该项目的 Discord bridge，然后当前终端直接进入共享 thread 的 Codex TUI。退出这个 TUI 后，后台 bridge 和 app-server 一并停止，行为与 `claude-dc` 接近。

普通任务执行期间，bridge 会把 Codex 的 `commentary` 中间进度按句子节流后立即回复到 Discord（以 `⏳` 开头），不再等到整个 turn 完成。最终答案仍会作为独立消息发送，final delta 不会被重复推送。

Discord 的 PNG、JPEG 和 WebP 图片附件会从 Discord CDN 受限下载（单张最多 20 MiB），作为 Codex app-server 的 `localImage` 输入，因此 Codex 可以直接识别截图。临时图片在 turn 结束后自动删除；其他附件仍以 URL 和文件名作为文本上下文。

可用函数：

- `codex-dc`：启动/恢复当前目录的主 bot 和共享 Codex TUI。
- `codex-dc-init`：创建独立 bot 配置，交互读取 token、用户 ID、频道 ID和 localhost 端口。
- `codex-dc-alt [N]`：启动同项目的第 N 个独立 bot，默认 N=2。
- `codex-dc-init N`：初始化 alt-N 的配置。
- `codex-dc-allow USER_IDS [CHANNEL_IDS] [N]`：修改 allowlist。
- `codex-dc-status [N]`：显示 thread、app-server/bridge PID 和日志位置。

隔离状态布局：

```text
~/.codex-discord/
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
- 图片附件限定为 Discord CDN 的 PNG、JPEG 和 WebP，单张最大 20 MiB；其他附件只提供元数据与 URL。
- app-server 接口由已安装 Codex CLI 提供；升级 Codex 后应重新运行测试。
- TUI 需要先知道 Discord channel 对应的 thread ID；目前通过 `!codex status` 后运行 attach 脚本完成，尚未自动切换。
