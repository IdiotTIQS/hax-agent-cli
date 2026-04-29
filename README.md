# Hax Agent CLI

Hax Agent CLI 是一个轻量级、Claude-like 的本地 Agent 命令行工具，用于在终端中发起对话、切换模型、调用本地文件工具，并生成认证模块重构的多 Agent 协作计划。

## 功能特性

- 交互式 Agent Shell：默认进入聊天模式，支持持续上下文对话。
- Provider 支持：默认使用本地 Mock 模式，也可配置 Anthropic API。
- 模型管理：查看可用模型，并在交互式 Shell 中切换模型。
- 本地工具：支持读取、写入、搜索、Glob 文件，以及受限 shell 命令执行。
- 会话记忆：自动保存对话 transcript，并在新会话中加载最近上下文。
- 团队计划：内置 `auth-refactor` 多 Agent 重构计划输出。

## 环境要求

- Node.js >= 18
- npm
- 如需连接真实模型，需要 Anthropic API Key 或兼容的 Anthropic API Base URL。

## 安装

```bash
npm install
```

本地开发时可以直接使用 npm 脚本：

```bash
npm start
```

也可以通过 `npx` 风格运行本地 bin：

```bash
node src/cli.js
```

如果需要全局链接命令：

```bash
npm link
hax-agent
```

## 快速开始

启动交互式 Shell：

```bash
npm start
```

或：

```bash
hax-agent
```

首次启动默认是本地 Mock 模式，不会调用真实模型。要使用真实模型，可以在 Shell 中设置：

```text
/api-url https://api.anthropic.com
/api-key your_api_key_here
/model claude-sonnet-4-20250514
```

也可以通过环境变量配置：

```bash
export HAX_AGENT_PROVIDER=anthropic
export ANTHROPIC_API_KEY=your_api_key_here
export HAX_AGENT_MODEL=claude-sonnet-4-20250514
npm start
```

## 命令用法

```bash
hax-agent                  # 启动交互式聊天
hax-agent chat             # 启动交互式聊天
hax-agent help             # 查看帮助
hax-agent models           # 查看当前 Provider 可用模型
hax-agent team auth-refactor # 输出认证模块重构团队计划
```

项目内置 npm 脚本：

```bash
npm start                  # node src/cli.js
npm run auth:team          # node src/cli.js team auth-refactor
npm test                   # node --test
```

## 交互式 Slash 命令

在 Shell 中输入以下命令：

```text
/help                      # 查看 Slash 命令
/exit                      # 退出 Shell
/clear                     # 清空当前上下文并新建会话
/tools                     # 查看可用本地工具
/agents                    # 查看内置 Agent 角色
/models                    # 查看可用模型
/model <model-id-or-number> # 切换模型
/api-url <base-url>        # 设置 API Base URL
/api-key <key>             # 设置 API Key
```

## 配置说明

配置会按以下优先级合并：

1. 默认配置
2. 用户配置：`~/.hax-agent/settings.json`
3. 项目配置：`./.hax-agent/settings.json`
4. 显式配置：`HAX_AGENT_SETTINGS` 指向的 JSON 文件
5. 环境变量覆盖

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `HAX_AGENT_PROVIDER` / `AI_PROVIDER` | Provider 名称，支持 `mock`、`local`、`anthropic`、`claude` |
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `HAX_AGENT_API_URL` / `ANTHROPIC_BASE_URL` | API Base URL |
| `HAX_AGENT_MODEL` / `AI_MODEL` | 模型 ID |
| `HAX_AGENT_MAX_TURNS` | 最大对话轮数 |
| `HAX_AGENT_TEMPERATURE` | 采样温度 |
| `HAX_AGENT_MEMORY_ENABLED` | 是否启用记忆 |
| `HAX_AGENT_MEMORY_DIR` | 记忆目录 |
| `HAX_AGENT_SESSION_DIR` | 会话目录 |
| `HAX_AGENT_TRANSCRIPT_LIMIT` | transcript 保存/读取限制 |
| `HAX_AGENT_MOCK_RESPONSE` | Mock 模式下的响应文本 |
| `HAX_AGENT_MOCK_DELAY_MS` | Mock 模式下的延迟毫秒数 |

配置文件示例：

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "your_api_key_here",
    "apiUrl": "https://api.anthropic.com",
    "temperature": 0.2
  },
  "memory": {
    "enabled": true,
    "directory": ".hax-agent/memory",
    "maxItems": 20
  },
  "sessions": {
    "directory": ".hax-agent/sessions",
    "transcriptLimit": 100
  }
}
```

> 建议不要把包含 API Key 的项目配置提交到版本库。

## 本地工具

Agent Shell 会创建一个限制在当前工作目录内的工具注册表，主要工具包括：

- `file.read`：读取工作区内文本文件。
- `file.write`：写入工作区内文本文件。
- `file.glob`：按 glob 模式列出文件。
- `file.search`：在文本文件中搜索内容。
- `shell.run`：执行受 allowlist 策略限制的本地命令。

所有文件路径都会被限制在工作区根目录内，防止访问项目外部路径。

## 会话与记忆

默认情况下，会话 transcript 保存在：

```text
.hax-agent/sessions
```

启动新 Shell 时会加载最近的用户/助手消息作为上下文。可以通过 `/clear` 清空当前上下文并创建新会话。

## 多 Agent 团队计划

内置 `auth-refactor` 团队计划用于认证模块重构，包括架构、Token、Session、Identity、安全审查和测试等角色。

运行：

```bash
npm run auth:team
```

或：

```bash
hax-agent team auth-refactor
```

## 开发与测试

运行测试：

```bash
npm test
```

项目使用 Node.js 内置 test runner（`node --test`）。主要源码目录：

```text
src/cli.js                 # CLI 入口与交互式 Shell
src/config.js              # 配置加载与环境变量覆盖
src/providers/             # Provider 实现与工厂
src/tools/                 # 本地工具注册与执行
src/teams/                 # 内置 Agent 团队定义
src/runtime/               # Agent runtime 相关模块
src/formatters/            # 输出格式化
```

## License

MIT
