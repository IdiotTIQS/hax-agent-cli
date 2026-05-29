# Hax Agent

> 轻量级、Claude-like 的本地 Agent 工具，CLI 仍是一等入口，同时提供 Electron + Vue 桌面端 · 由 [IdiotTIQS](https://github.com/IdiotTIQS) 开发

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)](#开发与贡献)
[![npm](https://img.shields.io/npm/v/hax-agent-cli)](https://www.npmjs.com/package/hax-agent-cli)

Hax Agent 是一个面向开发者的 AI 编码助手，CLI 仍是一等入口，同时提供 Electron + Vue 桌面端。支持 12+ AI 提供商（Anthropic、OpenAI、DeepSeek、Groq、Mistral、Google、Moonshot、智谱、DashScope、Ollama、vLLM、OpenRouter），支持交互式对话、多 Provider 切换、Provider 配置档案、本地文件工具、会话记忆管理、LSP 代码导航、终端主题切换以及 Hook 生命周期扩展。

---

## 目录

- [功能特性](#功能特性)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [桌面端](#桌面端)
- [使用方式](#使用方式)
- [交互式命令](#交互式命令)
- [Skills 技能系统](#skills-技能系统)
- [配置说明](#配置说明)
- [本地工具](#本地工具)
- [架构概览](#架构概览)
- [会话与记忆](#会话与记忆)
- [Provider 档案](#provider-档案)
- [开发与测试](#开发与测试)
- [License](#license)

---

## 功能特性

- **交互式 Agent Shell** — 默认进入聊天模式，支持持续上下文对话、斜杠命令和流式输出。
- **桌面 GUI** — Electron + Vue 界面，保留 CLI 工作流，同时提供会话列表、文件树、右侧状态面板和会话恢复。
- **多 Provider 支持** — 内置 12+ Provider：Anthropic（Claude）、OpenAI（GPT）、Google（Gemini）、DeepSeek、Groq、Mistral、Moonshot、智谱、DashScope、Ollama、vLLM、OpenRouter。
- **Provider 档案管理** — 预置 claude、gpt、sonnet、haiku、gpt-mini、local 档案，支持自定义档案，运行时一键切换。
- **模型管理** — 运行时查看可用模型、动态切换模型。
- **本地工具集** — 文件读写、搜索、Glob 匹配以及带权限确认的 shell 命令执行。
- **Skills 技能系统** — 支持创建、管理和调用可复用的技能，将重复性工作流封装为 SKILL.md 文件。
- **Hook 生命周期** — 10 种生命周期钩子（session.start/end、pre/post.compact、pre/post.tool_use 等），支持插件和脚本扩展。
- **LSP 代码导航** — 内置 `/lsp` 命令，支持 go-to-definition 和 workspace 符号搜索。
- **终端主题** — 支持多种终端颜色主题，`/theme` 命令实时切换。
- **会话记忆** — 自动保存对话 transcript，新会话自动加载最近的上下文。
- **分层配置** — 支持多级优先级配置合并，Provider 档案独立管理。
- **Cost 追踪** — 统计 token 用量与费用估算。
- **权限管理** — 四种权限模式：normal（询问）、yolo（全部批准）、plan（阻止写操作）、fullauto（静默批准）。

---

## 环境要求

- **Node.js** >= 18
- **npm**（或 pnpm / yarn）
- **API Key**（至少一个 Provider）

---

## 快速开始

### 1. 安装

```bash
# 从 npm 安装
npm install -g hax-agent-cli

# 或从源码安装
git clone https://github.com/IdiotTIQS/hax-agent-cli.git
cd hax-agent-cli
npm install
```

### 2. 启动交互式 Shell

```bash
hax-agent
# 或
npm start
```

首次运行 `hax-agent` 时，如果还没有配置 API Key，可以使用 `/api-key` 命令设置：

```text
/api-key anthropic sk-ant-xxxxxxxxxxxx
/api-key openai sk-xxxxxxxxxxxx
```

也可以使用预置的 Provider 档案快速切换：

```text
/provider claude        # 切换到 Anthropic Claude
/provider gpt           # 切换到 OpenAI GPT
/provider local         # 切换到本地 Ollama
/provider list          # 查看所有可用档案
```

### 3. 配置 Provider

在 Shell 中运行时设置：

```text
/provider anthropic     # 切换到 Anthropic
/provider openai        # 切换到 OpenAI
/provider deepseek      # 切换到 DeepSeek
/model claude-sonnet-4-20250514
/api-url https://api.anthropic.com
/api-key anthropic sk-ant-xxxxxxxxxxxx
```

或通过环境变量预配置（见[配置说明](#配置说明)）。

## 桌面端

桌面端与 CLI 共用同一套配置、会话存储和工具层。

### 启动开发版

```bash
npm run desktop:dev
```

### 构建桌面端

```bash
npm run desktop:build
```

---

## 使用方式

```bash
# 启动交互式聊天（默认）
hax-agent
hax-agent chat

# 查看帮助和版本
hax-agent help
hax-agent -v

# 查看当前 Provider 可用模型
hax-agent models

# 运行诊断（可用于脚本）
hax-agent doctor --json

# 查看和管理历史会话
hax-agent sessions
hax-agent resume <session-id>

# 查看或编辑配置
hax-agent config
hax-agent config edit

# 其他选项
hax-agent --no-color    # 禁用彩色输出
hax-agent --debug       # 启用详细调试日志

# 全局链接后可直接使用
npm link
hax-agent               # 任意目录下可用
```

### 内置 npm 脚本

| 命令 | 说明 |
|------|------|
| `npm start` | 启动 CLI（`node src/cli.js`） |
| `npm run desktop:dev` | 启动 Electron + Vue 桌面端开发模式 |
| `npm run desktop:build` | 构建桌面端前端资源 |
| `npm run desktop:start` | 直接启动 Electron 桌面端 |
| `npm run auth:team` | 输出认证重构团队计划 |
| `npm run lint` | 对 JS 文件运行语法检查 |
| `npm test` | 运行测试套件 |
| `npm run test:desktop` | 构建桌面端并运行桌面端测试 |

---

## 交互式命令

在 Shell 中输入以下斜杠命令：

| 命令 | 说明 |
|------|------|
| `/help` | 查看所有可用命令 |
| `/exit` 或 `/quit` | 退出 Shell |
| `/clear` | 清空当前上下文并新建会话 |
| `/compact` | 压缩当前对话，降低上下文占用 |
| `/tools` | 查看可用本地工具列表 |
| `/skills` | 列出 Skills |
| `/goal [--max n] <goal>` | 设置持续目标，直到完成、阻塞或 `/goal clear` |
| `/models` | 查看当前 Provider 可用模型 |
| `/model <id>` | 切换模型 |
| `/provider <name>` | 切换 Provider 档案（`list` 查看所有） |
| `/providers` | 列出所有可用的 AI 提供商 |
| `/api-url <base-url>` | 设置或查看 API Base URL |
| `/api-key <provider> <key>` | 设置 Provider 的 API Key |
| `/cost` | 查看当前会话 token 和费用 |
| `/status` | 查看会话摘要（模型、费用、tokens） |
| `/context` | 查看上下文窗口使用情况 |
| `/config` | 查看当前配置 |
| `/copy` | 复制最后一条 AI 回复到剪贴板 |
| `/export` | 导出会话到 JSON 文件 |
| `/doctor` | 运行环境诊断 |
| `/theme <name>` | 切换终端颜色主题（`list` 查看所有） |
| `/yolo` | 切换 YOLO 模式（自动批准所有工具） |
| `/plan` | 切换 Plan 模式（阻止所有写操作） |
| `/fullauto` | 切换 Full Auto 模式（静默批准所有工具） |
| `/perms` | 查看权限状态 |
| `/permissions [allow\|deny\|reset\|yolo\|normal] [tool]` | 管理工具权限 |
| `/allow <tool>` | 始终允许某个工具 |
| `/deny <tool>` | 始终拒绝某个工具 |
| `/memory [search\|list]` | 管理持久化记忆 |
| `/lsp def <symbol>` | 跳转到符号定义 |
| `/lsp search <query>` | 搜索工作区符号 |
| `/personalize` | 从对话中提取环境规则保存到 rules.md |
| `/init` | 初始化 .hax-agent 项目目录 |
| `/version` | 查看版本信息 |

---

## Skills 技能系统

Skills 是可复用的工作流封装，允许你将重复性的任务流程保存为 SKILL.md 文件，在后续会话中通过斜杠命令快速调用。

### 技能目录结构

技能存储在以下位置：

```text
~/.hax-agent/skills/          # 用户级技能（跨项目可用）
├── code-review/
│   └── SKILL.md
└── deploy-workflow/
    └── SKILL.md

.hax-agent/skills/            # 项目级技能（仅当前项目可用）
├── run-tests/
│   └── SKILL.md
└── ...
```

每个技能是一个目录，包含一个 `SKILL.md` 文件。

### SKILL.md 格式

```markdown
---
name: my-skill
description: 一句话描述这个技能的作用
allowed-tools:
  - file.read
  - file.write
  - shell.run
when_to_use: 描述何时自动调用此技能。以 "Use when..." 开头。
argument-hint: "[arg1] [arg2]"
arguments:
  - arg1
  - arg2
---

# 技能标题

详细描述此技能的工作流程。

## Inputs
- `$arg1`: 描述这个输入

## Goal
清晰陈述此工作流的目标。

## Steps

### 1. 步骤名称
此步骤要做什么。具体且可操作。

**Success criteria**: 始终包含！这表明步骤已完成，可以继续下一步。
```

### 调用技能

在 Shell 中，直接输入技能名作为斜杠命令：

```text
/code-review                    # 调用代码审查技能
/code-review src/index.js       # 带参数调用
/skills                         # 列出所有可用技能
```

---

## 配置说明

### 配置层级

1. **默认配置** — 内置于 `src/config/settings.js`
2. **用户配置** — `~/.hax-agent/settings.json`
3. **环境变量** — 所有 `HAX_AGENT_*` 前缀变量

> ⚠️ 建议不要把包含 API Key 的配置提交到版本库。推荐使用环境变量或用户配置。

### 支持的 Provider

| Provider | 别名 | 默认模型 | 环境变量 |
|----------|------|----------|----------|
| **Anthropic** | `anthropic`, `claude` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `openai`, `gpt` | `gpt-4o` | `OPENAI_API_KEY` |
| **DeepSeek** | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| **Groq** | `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| **Mistral** | `mistral` | `mistral-large-latest` | `MISTRAL_API_KEY` |
| **Google** | `google`, `gemini` | `gemini-2.5-pro` | `GOOGLE_API_KEY` |
| **Moonshot** | `moonshot` | `moonshot-v1-8k` | `MOONSHOT_API_KEY` |
| **智谱** | `zhipu` | `glm-4-plus` | `ZHIPUAI_API_KEY` |
| **DashScope** | `dashscope` | `qwen-max` | `DASHSCOPE_API_KEY` |
| **OpenRouter** | `openrouter` | `anthropic/claude-sonnet-4` | `OPENROUTER_API_KEY` |
| **Ollama** | `ollama` | `llama3.2` | — (本地) |
| **vLLM** | `vllm` | — | — (本地) |

### 完整环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HAX_AGENT_PROVIDER` | Provider 名称 | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | — |
| `GROQ_API_KEY` | Groq API Key | — |
| `MISTRAL_API_KEY` | Mistral API Key | — |
| `GOOGLE_API_KEY` | Google API Key | — |
| `HAX_AGENT_MODEL` | 模型 ID | — |
| `HAX_AGENT_MAX_TURNS` | 最大对话轮数 | `25` |
| `HAX_AGENT_API_URL` | API Base URL | — |
| `HAX_AGENT_PERMISSIONS_MODE` | 默认权限模式 | `normal` |
| `HAX_AGENT_SHELL_ENABLED` | 是否启用 shell 工具 | `true` |

### 配置文件示例

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTurns": 25
  },
  "permissions": {
    "mode": "normal"
  },
  "tools": {
    "shell": {
      "enabled": true
    }
  },
  "ui": {
    "locale": "en",
    "autoClearScreen": true
  },
  "context": {
    "compactionEnabled": false,
    "compactionThreshold": 0.85
  }
}
```

---

## 本地工具

Agent Shell 内置一个受限制的工具注册表，所有文件操作均限定在工作区根目录内，防止路径穿越攻击。

| 工具 | 说明 | 安全限制 |
|------|------|----------|
| `file.read` | 读取工作区内文本文件 | 路径限制在工作区根目录内 |
| `file.write` | 写入工作区内文本文件 | 路径限制在工作区根目录内 |
| `file.edit` | 精准替换文件中的指定文本 | 路径限制在工作区根目录内 |
| `file.delete` | 删除文件（默认移到回收站） | 路径限制在工作区根目录内 |
| `file.glob` | 按 Glob 模式匹配文件列表 | 路径限制在工作区根目录内 |
| `file.search` | 在文本文件中搜索内容 | 支持正则/大小写配置 |
| `file.readDirectory` | 列出目录内容 | 路径限制在工作区根目录内 |
| `shell.run` | 执行本地命令 | 非 yolo 模式下由权限确认决定 |
| `web.fetch` | 获取网页内容并转为纯文本 | URL 获取 |
| `web.search` | 搜索互联网信息 | 需配置搜索 API |

---

## 架构概览

```
src/
├── index.js                      # 模块导出入口
├── cli.js                        # CLI 入口 + 交互式 Shell
├── api/
│   ├── provider.js               # 12+ Provider 客户端与注册表
│   └── retry.js                  # 重试逻辑
├── commands/
│   ├── registry.js               # ~30 个斜杠命令
│   └── extended-commands.js      # 扩展命令
├── config/
│   ├── settings.js               # 配置加载与持久化
│   └── profiles.js               # Provider 档案管理
├── core/                         # 基础层 — 类型化协议
│   ├── api/
│   │   ├── errors.js             # API 错误分类
│   │   └── provider-adapter.js   # Provider 适配器协议与流事件类型
│   ├── messages/
│   │   └── types.js              # StandardMessage、ContentBlock 类型、流事件
│   ├── memory/
│   │   └── compaction.js         # Token 估算与压缩工具
│   └── permissions/
│       └── checker.js            # 权限检查器
├── engine/                       # Agent 运行时
│   ├── agent.js                  # AgentEngine、Session、HookExecutor
│   └── query.js                  # QueryContext 状态追踪
├── hooks/
│   └── registry.js               # Hook 注册表
├── memory/
│   ├── compact.js                # 消息微压缩
│   └── store.js                  # 持久化记忆存储
├── plugins/
│   ├── installer.js              # 插件安装
│   ├── registry.js               # 插件自动发现
│   └── schema.js                 # 插件清单验证
├── prompts/
│   └── manager.js                # 系统提示词组装
├── services/                     # 辅助服务
│   ├── autodream.js              # 自动目标续跑
│   ├── lsp.js                    # LSP 代码导航
│   ├── mcp.js                    # MCP 服务集成
│   ├── memory-extract.js         # 记忆提取
│   ├── personalization.js        # 个性化规则提取
│   └── session-memory.js         # 会话记忆
├── shared/
│   ├── themes.js                 # 终端主题
│   └── utils.js                  # ANSI 码与样式工具
├── skills/
│   └── registry.js               # 技能自动发现与加载
├── tools/
│   ├── registry.js               # 10 个内置工具
│   ├── agent-tool.js             # Agent 子进程工具
│   ├── extended.js               # 扩展工具集
│   ├── image-tools.js            # 图像处理
│   ├── mcp-tools.js              # MCP 工具集成
│   ├── plan-mode-tool.js         # 计划模式工具
│   ├── send-message-tool.js      # Agent 间消息
│   └── worktree-tool.js          # Git worktree 管理
└── tui/
    └── index.js                  # 终端 UI（alt-screen、事件渲染、状态栏）

desktop/
├── main/                         # Electron 主进程
├── preload/                      # 预加载脚本
└── renderer/                     # Vue 桌面端前端
    ├── src/
    └── vite.config.js
```

### 核心模块职责

| 模块 | 职责 |
|------|------|
| `api/provider.js` | 统一流式 Provider 客户端，12+ Provider 注册表 |
| `core/api/provider-adapter.js` | 类型化 Provider 适配器协议，流事件类型，Anthropic/OpenAI 适配器 |
| `core/messages/types.js` | StandardMessage 类，ContentBlock 判别联合，token 估算，格式转换 |
| `core/permissions/checker.js` | 权限检查器，四种模式，敏感路径检测 |
| `engine/agent.js` | AgentEngine 主循环，Session 管理，HookExecutor 生命周期分发 |
| `engine/query.js` | QueryContext：任务焦点、文件追踪、技能调用、工作日志 |
| `config/settings.js` | 配置加载保存，`~/.haxagent/settings.json` |
| `config/profiles.js` | ProfileManager：内置 + 自定义 Provider 档案，运行时切换 |
| `commands/registry.js` | ~30 个斜杠命令的注册与分发 |
| `tools/registry.js` | ToolRegistry：10 个内置工具，isReadOnly 分类，路径沙箱 |
| `tui/index.js` | 终端 UI：alt-screen 缓冲，事件驱动渲染，权限确认提示 |
| `skills/registry.js` | 技能发现、加载与系统提示词生成 |
| `services/lsp.js` | LSP 代码导航：go-to-definition、workspace 符号搜索 |
| `services/personalization.js` | 环境规则提取与 rules.md 生成 |
| `memory/store.js` | 持久化记忆 CRUD 与搜索 |
| `memory/compact.js` | Token 感知的消息压缩 |

---

## 会话与记忆

### 会话存储

所有会话 transcript 保存在配置目录中：

```text
.hax-agent/sessions/
├── 2025-01-15T10-30-00-000Z-a1b2c3d4.jsonl
└── ...
```

- 每条记录一行 JSON，包含 `timestamp`、`role`、`content` 等字段。
- 桌面端"最近会话"列表直接读取这些 transcript，可恢复历史会话继续对话。

### 记忆存储

持久化记忆保存在：

```text
.hax-agent/memory/
├── user-preferences-5f8a2b1c.json
└── ...
```

- 每个记忆为独立文件，支持通过 `/memory search <query>` 或 `/memory list` 管理。
- `/personalize` 命令从对话中提取环境规则保存到 `.hax-agent/rules.md`。

---

## Provider 档案

通过 `/provider` 命令使用预置档案快速切换 AI 提供商：

| 档案名 | Provider | 模型 |
|--------|----------|------|
| `claude` | Anthropic | claude-sonnet-4-20250514 |
| `sonnet` | Anthropic | claude-sonnet-4-20250514 |
| `haiku` | Anthropic | claude-haiku-3-5-20241022 |
| `gpt` | OpenAI | gpt-4o |
| `gpt-mini` | OpenAI | gpt-4o-mini |
| `local` | Ollama | (本地配置) |

自定义档案通过 `~/.haxagent/profiles.json` 管理，支持 `/provider <name>` 一键切换。

---

## 开发与测试

### 运行测试

```bash
npm test
```

项目使用 Node.js 内置 test runner（`node --test`）。测试文件位于 `test/` 目录。

### 目录规范

- `src/` — 源码，遵循 CommonJS 模块规范，分层架构（core → engine → api/tools/services）
- `desktop/` — 桌面端源码，与 CLI 共用核心层
- `test/` — 测试文件
- `.hax-agent/` — 运行时数据（会话、记忆、设置），已加入 `.gitignore`

### 开发与贡献

1. Fork 本仓库
2. 创建你的特性分支（`git checkout -b feat/amazing-feature`）
3. 提交你的修改（`git commit -m 'feat: add amazing feature'`）
4. 推送到分支（`git push origin feat/amazing-feature`）
5. 打开一个 Pull Request

欢迎提交 Issue 和 PR！请确保：
- 新增功能包含对应的测试用例
- 保持代码风格一致（现有风格）
- 更新相关文档

---

## License

MIT © [IdiotTIQS](https://github.com/IdiotTIQS)

---

*Hax Agent CLI — 让 AI 编码助手在你的终端里为你服务。*
