# Hax Agent

> 轻量级、Claude-like 的本地 Agent 工具，CLI 仍是一等入口，同时提供 Electron + Vue 桌面端 · 由 [IdiotTIQS](https://github.com/IdiotTIQS) 开发

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)](#开发与贡献)
[![npm](https://img.shields.io/npm/v/hax-agent-cli)](https://www.npmjs.com/package/hax-agent-cli)

Hax Agent 是一个面向开发者的 AI 编码助手，CLI 仍是一等入口，同时提供 Electron + Vue 桌面端。支持 Anthropic、OpenAI、Google 三大主流 AI 提供商，支持交互式对话、多 Provider 切换、本地文件工具、会话记忆管理、最近会话恢复以及多 Agent 团队协作计划生成。

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
- [多 Agent 团队](#多-agent-团队)
- [开发与测试](#开发与测试)
- [License](#license)

---

## 功能特性

- **交互式 Agent Shell** — 默认进入聊天模式，支持持续上下文对话、斜杠命令和流式输出。
- **桌面 GUI** — Electron + Vue 界面，保留 CLI 工作流，同时提供会话列表、文件树、右侧状态面板和会话恢复。
- **多 Provider 支持** — 内置 Anthropic（Claude）、OpenAI（GPT）、Google（Gemini）三大主流 Provider，支持运行时切换。
- **模型管理** — 运行时查看可用模型、动态切换模型。
- **本地工具集** — 文件读写、搜索、Glob 匹配以及受 allowlist 限制的 shell 命令执行。
- **Skills 技能系统** — 支持创建、管理和调用可复用的技能，将重复性工作流封装为 SKILL.md 文件。
- **会话记忆** — 自动保存对话 transcript，新会话自动加载最近的上下文。
- **分层配置** — 支持 5 级优先级配置合并（默认 → 用户 → 项目 → 显式 → 环境变量）。
- **多 Agent 团队** — 内置 `auth-refactor` 认证重构团队计划，支持输出结构化协作方案。
- **Cost 追踪** — 统计 token 用量与费用估算。

---

## 环境要求

- **Node.js** >= 18
- **npm**（或 pnpm / yarn）
- **API Key**（Anthropic / OpenAI / Google，至少一个）

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

首次在真实终端运行 `hax-agent` 时，如果还没有配置文件或 Provider 环境变量，会自动进入初始化向导。也可以随时手动运行：

```bash
hax-agent init
```

向导会依次选择 Provider、填写 API Key、配置可选 API Base URL、设置默认模型、选择权限模式，并决定是否启用会话记忆。Provider 和权限模式可用方向键选择，按 Enter 确认。

### 3. 配置 Provider

在 Shell 中运行时设置：

```text
/provider anthropic     # 切换到 Anthropic
/provider openai        # 切换到 OpenAI
/provider google        # 切换到 Google
/api-url https://api.anthropic.com
/api-key sk-ant-xxxxxxxxxxxx
/model claude-sonnet-4-20250514
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

# 运行初始化向导
hax-agent init

# 查看当前 Provider 可用模型
hax-agent models

# 查看内置 Agent 角色
hax-agent agents

# 运行诊断（可用于脚本）
hax-agent doctor --json

# 输出认证模块重构团队计划
hax-agent team auth-refactor

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
| `npm run lint` | 对 JS/MJS 文件运行语法检查 |
| `npm test` | 运行测试套件 |
| `npm run test:desktop` | 构建桌面端并运行桌面端测试 |

---

## 交互式命令

在 Shell 中输入以下斜杠命令：

| 命令 | 说明 |
|------|------|
| `/help` | 查看所有可用命令 |
| `/exit` 或 `/quit` | 退出 Shell |
| `/clear` 或 `/new` | 清空当前上下文并新建会话 |
| `/compact` | 压缩当前对话，降低上下文占用 |
| `/tools` | 查看可用本地工具列表 |
| `/skills [list|usage]` | 列出 Skills 或查看使用统计 |
| `/skillify [description]` | 将当前会话捕获为可复用 Skill |
| `/agents` | 查看内置 Agent 角色 |
| `/team [command]` | 管理 Agent 团队、任务和消息 |
| `/models` | 查看当前 Provider 可用模型 |
| `/model <id-or-number>` | 切换模型 |
| `/provider <name>` | 切换 AI Provider（`anthropic`、`openai`、`google`） |
| `/api-url <base-url>` | 设置 API Base URL |
| `/api-key <key>` | 设置 API Key |
| `/language <en|zh-CN|zh-TW|ru>` | 切换 CLI 语言 |
| `/cost` | 查看当前会话 token 和费用 |
| `/sessions` | 列出历史会话 |
| `/resume [session-id]` | 恢复历史会话 |
| `/rename <name>` | 为当前会话命名 |
| `/config` | 查看当前配置 |
| `/copy` | 复制最后一条 AI 回复到剪贴板 |
| `/doctor [--json]` | 运行环境诊断，`--json` 输出机器可读结果 |
| `/theme` | 切换终端颜色主题 |
| `/vim` | 切换 Vim 键位模式 |
| `/memory [list|read|write|delete]` | 管理持久化记忆 |
| `/permissions [status|mode|reset]` | 查看或管理工具权限 |
| `/update [install]` | 检查或安装 CLI 更新 |

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
when_to_use: 描述何时自动调用此技能。以 "Use when..." 开头，包含触发短语和示例消息。
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

### 2. 另一步骤
...

**Human checkpoint**: 何时暂停并询问用户（特别是不可逆操作）。
```

### 调用技能

在 Shell 中，直接输入技能名作为斜杠命令：

```text
/code-review                    # 调用代码审查技能
/code-review src/index.js       # 带参数调用
/skillify                       # 将当前会话捕获为技能
/skills                         # 列出所有可用技能
/skills usage                   # 查看技能使用统计
```

### 将会话捕获为技能

使用 `/skillify` 命令将当前会话的重复性流程保存为可复用技能：

```text
/skillify                       # 交互式创建技能
/skillify deploy workflow       # 描述要捕获的流程
```

AI 会分析会话内容，识别可复用的步骤，并引导你创建 SKILL.md 文件。

### 技能使用追踪

系统自动追踪每个技能的使用频率和最近使用时间，支持基于使用频率和新鲜度的智能排序。

---

## 配置说明

### 配置优先级（从低到高）

1. **默认配置** — 内置于 `src/config.js` 的 `DEFAULT_SETTINGS`
2. **用户配置** — `~/.hax-agent/settings.json`
3. **项目配置** — `./.hax-agent/settings.json`
4. **显式配置** — `HAX_AGENT_SETTINGS` 环境变量指向的 JSON 文件
5. **环境变量覆盖** — 以下列出的所有环境变量

> ⚠️ 建议不要把包含 API Key 的项目配置提交到版本库。推荐使用环境变量或用户配置。

### 支持的 Provider

| Provider | 别名 | 默认模型 | 环境变量 |
|----------|------|----------|----------|
| **Anthropic** | `anthropic`, `claude` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` |
| **OpenAI** | `openai`, `gpt` | `gpt-4.1` | `OPENAI_API_KEY`, `OPENAI_BASE_URL` |
| **Google** | `google`, `gemini` | `gemini-2.5-flash-preview-05-20` | `GOOGLE_API_KEY`, `GOOGLE_BASE_URL` |

### 完整环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HAX_AGENT_PROVIDER` / `AI_PROVIDER` | Provider 名称（`mock`、`local`、`anthropic`、`claude`、`openai`、`gpt`、`google`、`gemini`） | `mock` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `GOOGLE_API_KEY` | Google API Key | — |
| `HAX_AGENT_API_URL` / `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `GOOGLE_BASE_URL` | API Base URL | — |
| `HAX_AGENT_MODEL` | 模型 ID | `claude-sonnet-4-20250514` |
| `HAX_AGENT_MAX_TURNS` | 最大对话轮数 | `20` |
| `HAX_AGENT_TEMPERATURE` | 采样温度 | `0.2` |
| `HAX_AGENT_MAX_TOKENS` | 最大生成 Token 数 | — |
| `HAX_AGENT_MOCK_RESPONSE` | Mock 模式下的响应文本 | — |
| `HAX_AGENT_MOCK_DELAY_MS` | Mock 模式下的延迟毫秒数 | `0` |
| `HAX_AGENT_MOCK_TOOL_TRACE` | Mock 工具调用追踪（`1` 启用） | — |
| `HAX_AGENT_MEMORY_ENABLED` | 是否启用记忆 | `true` |
| `HAX_AGENT_MEMORY_DIR` | 记忆目录 | 系统应用数据目录下的 `memory` |
| `HAX_AGENT_MEMORY_MAX_ITEMS` | 记忆最大条目数 | `20` |
| `HAX_AGENT_SESSION_DIR` | 会话目录 | 系统应用数据目录下的 `sessions` |
| `HAX_AGENT_TRANSCRIPT_LIMIT` | Transcript 保存/读取限制 | `100` |
| `HAX_AGENT_INCLUDE_SETTINGS` | 提示词中是否包含设置 | `true` |
| `HAX_AGENT_INCLUDE_MEMORY` | 提示词中是否包含记忆 | `true` |
| `HAX_AGENT_INCLUDE_TRANSCRIPT` | 提示词中是否包含最近对话 | `true` |
| `HAX_AGENT_MAX_TRANSCRIPT_MESSAGES` | 提示词中最大对话消息数 | `20` |
| `HAX_AGENT_CONTEXT_ENABLED` | 是否启用上下文窗口管理 | `true` |
| `HAX_AGENT_CONTEXT_WINDOW_TOKENS` | 上下文窗口 token 数 | 按模型自动推断 |
| `HAX_AGENT_CONTEXT_RESERVE_OUTPUT_TOKENS` | 预留输出 token 数 | `8192` |
| `HAX_AGENT_CONTEXT_CHARS_PER_TOKEN` | 字符到 token 的估算比例 | `4` |
| `HAX_AGENT_FILE_CONTEXT_ENABLED` | 是否启用相关文件上下文召回 | `true` |
| `HAX_AGENT_FILE_CONTEXT_MAX_FILES` | 每轮最多召回文件数 | `8` |
| `HAX_AGENT_FILE_CONTEXT_MAX_INDEX_FILES` | 文件索引最多扫描文件数 | `2000` |
| `HAX_AGENT_FILE_CONTEXT_MAX_FILE_SIZE` | 文件索引单文件大小上限 | `512000` |
| `HAX_AGENT_FILE_CONTEXT_MAX_BYTES_PER_FILE` | 注入提示词的单文件字节上限 | `32000` |
| `HAX_AGENT_FILE_CONTEXT_MAX_TOTAL_BYTES` | 注入提示词的总字节上限 | `120000` |
| `HAX_AGENT_PERMISSIONS_MODE` | 默认权限模式（`normal`、`yolo`） | `normal` |
| `HAX_AGENT_UPDATES_AUTO_INSTALL` | 是否自动安装更新 | `false` |
| `HAX_AGENT_DESKTOP_WORKSPACE` | 桌面端默认工作区 | — |
| `HAX_AGENT_LOCALE` / `HAX_AGENT_LANGUAGE` | CLI 语言 | `en` |
| `HAX_AGENT_SHELL_ENABLED` | 是否启用 shell 工具 | `true` |
| `HAX_AGENT_SHELL_COMMANDS` | 允许的命令列表（逗号分隔） | 见 `src/config.js` 默认 allowlist |
| `HAX_AGENT_SHELL_TIMEOUT_MS` | Shell 命令超时毫秒数 | `10000` |
| `HAX_AGENT_SHELL_MAX_BUFFER` | Shell 命令最大输出字节数 | `200000` |
| `HAX_AGENT_PROJECT_ROOT` | 项目根目录（覆盖 `process.cwd()`） | — |
| `HAX_AGENT_USER_SETTINGS` | 用户配置路径 | `~/.hax-agent/settings.json` |
| `HAX_AGENT_PROJECT_SETTINGS` | 项目配置路径 | `./.hax-agent/settings.json` |
| `HAX_AGENT_SETTINGS` | 显式配置文件路径 | — |

### 配置文件示例

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-ant-xxxxxxxxxxxx",
    "apiUrl": "https://api.anthropic.com",
    "temperature": 0.2,
    "maxTurns": 20
  },
  "memory": {
    "enabled": true,
    "directory": ".hax-agent/memory",
    "maxItems": 20
  },
  "sessions": {
    "directory": ".hax-agent/sessions",
    "transcriptLimit": 100
  },
  "prompts": {
    "includeSettings": true,
    "includeMemory": true,
    "includeTranscript": true,
    "maxTranscriptMessages": 20
  },
  "tools": {
    "shell": {
      "enabled": true,
      "allowedCommands": ["node", "npm", "git"],
      "timeoutMs": 10000,
      "maxBuffer": 200000
    }
  }
}
```

---

## 本地工具

Agent Shell 内置一个受限制的工具注册表，所有文件操作均限定在工作区根目录内，防止路径穿越攻击。

| 工具 | 说明 | 安全限制 |
|------|------|----------|
| `file.read` | 读取工作区内文本文件，支持分页 | 路径限制在工作区根目录内 |
| `file.write` | 写入工作区内文本文件 | 路径限制在工作区根目录内 |
| `file.edit` | 精准替换文件中的指定文本，显示 diff 预览 | 路径限制在工作区根目录内 |
| `file.delete` | 删除文件（默认移到回收站） | 路径限制在工作区根目录内 |
| `file.glob` | 按 Glob 模式匹配文件列表 | 路径限制在工作区根目录内 |
| `file.search` | 在文本文件中搜索内容 | 支持正则/大小写配置 |
| `file.readDirectory` | 列出目录内容 | 路径限制在工作区根目录内 |
| `shell.run` | 执行本地命令 | 仅 allowlist 内的命令（默认 `node`, `npm`, `git`） |
| `web.fetch` | 获取网页内容并转为纯文本 | 阻止内网/私有地址 |
| `web.search` | 搜索互联网信息 | DuckDuckGo + Bing 备用 |
| `stock.quote` | 查询实时股票/指数行情 | A 股、港股、美股 |

---

## 架构概览

```
src/
├── index.js                      # 模块导出入口
├── cli.js                        # CLI 入口 + 交互式 Shell
├── config.js                     # 分层配置加载与环境变量覆盖
├── context.js                    # 提示词上下文组装
├── context-window.js             # Token 预算与上下文窗口管理
├── file-context.js               # 相关文件上下文召回
├── memory.js                     # 会话记忆与持久化存储
├── session.js                    # 会话生命周期与 Cost 追踪
├── agent-engine.js               # Agent 引擎：工具调用循环
├── orchestration.js              # Agent 协调逻辑
├── slash-commands.js             # 启动流程、Banner、斜杠命令路由
├── renderer.js                   # 终端渲染、Markdown、ANSI 主题
├── i18n.js                       # 多语言国际化
├── init-wizard.js                # 首次运行初始化向导
├── updater.js                    # CLI 自更新
├── command-suggestions.js        # 命令纠错建议
├── permissions.js                # 工具权限管理
├── debug.js                      # 调试日志
│
├── providers/                    # AI Provider 抽象层
│   ├── index.js                  #   模块导出
│   ├── factory.js                #   Provider 工厂 + 注册机制
│   ├── chat-provider.js          #   基础 Provider 抽象类
│   ├── anthropic-provider.js     #   Anthropic (Claude) 实现
│   ├── openai-provider.js        #   OpenAI (GPT) 实现
│   ├── google-provider.js        #   Google (Gemini) 实现
│   ├── mock-provider.js          #   本地 Mock 实现
│   ├── messages.js               #   消息格式规范化
│   └── shared.js                 #   Provider 共享工具
│
├── runtime/                      # Agent 运行时
│   ├── index.js                  #   模块导出
│   ├── agents.js                 #   Agent 角色定义
│   ├── commands.js               #   斜杠命令处理
│   ├── composition.js            #   Agent 组合逻辑
│   ├── messages.js               #   运行时消息处理
│   ├── sessions.js               #   会话生命周期
│   └── tasks.js                  #   任务定义与执行
│
├── teams/                        # 多 Agent 团队
│   ├── agents.js                 #   Agent 角色定义
│   ├── auth-refactor.js          #   认证重构团队计划
│   ├── runtime.js                #   团队运行时
│   └── tools.js                  #   Agent 团队工具
│
├── tools/                        # 本地工具注册表
│   ├── index.js                  #   工具注册入口
│   ├── registry.js               #   工具注册表 + 沙箱执行
│   ├── error.js                  #   工具错误类型
│   ├── utils.js                  #   序列化 & 工具函数
│   ├── file-read.js              #   file.read — 读取文件
│   ├── file-write.js             #   file.write — 写入文件
│   ├── file-edit.js              #   file.edit — 精准编辑
│   ├── file-delete.js            #   file.delete — 删除文件
│   ├── file-glob.js              #   file.glob — Glob 匹配
│   ├── file-search.js            #   file.search — 内容搜索
│   ├── file-readdir.js           #   file.readDirectory — 目录列表
│   ├── shell.js                  #   shell.run — 命令执行
│   ├── web-fetch.js              #   web.fetch — 网页抓取
│   ├── web-search.js             #   web.search — 网络搜索
│   └── stock-quote.js            #   stock.quote — 股票行情
│
├── commands/                     # 斜杠命令系统
│   ├── index.js                  #   模块导出
│   ├── definitions.js            #   命令定义
│   ├── handlers.js               #   命令处理器
│   ├── autocomplete.js           #   Tab 自动补全
│   └── shell-ui.js               #   输入历史、语法高亮
│
├── skills/                       # Skills 技能系统
│   ├── index.js                  #   模块导出
│   ├── loader.js                 #   技能加载器
│   ├── parser.js                 #   SKILL.md 解析器
│   ├── intent-matcher.js         #   意图匹配
│   ├── skillify.js               #   会话捕获为技能
│   └── usage.js                  #   使用统计追踪
│
├── formatters/                   # 输出格式化
│   ├── agent-teams.js            #   Agent 团队输出
│   └── team-plan.js              #   团队计划格式化
│
└── utils/                        # 通用工具
    └── serialization.js          #   Provider 序列化共享

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
| `config.js` | 多源配置合并、环境变量解析、配置持久化 |
| `context.js` | 将设置、记忆、对话历史组装为 system prompt |
| `context-window.js` | Token 预算管理与上下文窗口截断 |
| `file-context.js` | 按关键词召回项目相关文件注入提示词 |
| `memory.js` | JSON/JSONL 文件存储、会话 transcript 读写、记忆 CRUD |
| `agent-engine.js` | Agent 主循环：发送请求 → 执行工具 → 收集结果 |
| `session.js` | 会话生命周期、CostTracker token 用量统计 |
| `slash-commands.js` | 启动 Banner、斜杠命令路由、首次运行检测 |
| `renderer.js` | ANSI 主题、Markdown 渲染、终端输出格式化 |
| `i18n.js` | 中/英/繁/俄多语言支持 |
| `init-wizard.js` | 交互式初始化向导（Provider、API Key、权限） |
| `updater.js` | 版本检查与自更新 |
| `command-suggestions.js` | 命令纠错建议 |
| `permissions.js` | 工具权限等级管理与策略执行 |
| `providers/` | Provider 抽象与工厂模式，支持动态注册新 Provider |
| `runtime/` | 会话管理、Agent 角色编排、任务调度、命令解析 |
| `teams/` | 多 Agent 团队计划定义、运行时与通信工具 |
| `tools/` | 模块化工具注册表、路径安全验证、执行沙箱 |
| `commands/` | 斜杠命令定义、处理、自动补全与输入历史 |
| `skills/` | Skills 技能解析、加载、意图匹配与使用追踪 |
| `desktop/` | Electron 主进程、预加载脚本、Vue 桌面端界面 |

---

## 会话与记忆

### 会话存储

所有会话 transcript 以 JSONL 格式保存在配置目录中：

```text
.hax-agent/sessions/
├── 2025-01-15T10-30-00-000Z-a1b2c3d4.jsonl
├── 2025-01-15T11-00-00-000Z-e5f6g7h8.jsonl
└── ...
```

- 每条记录一行 JSON，包含 `timestamp`、`role`、`content` 等字段。
- 新会话会自动按时间戳 + 随机后缀生成文件名。
- 启动时自动加载最近 transcript 作为上下文。
- 桌面端“最近会话”列表直接读取这些 transcript，可恢复历史会话继续对话。

### 记忆存储

持久化记忆以 JSON 格式保存在：

```text
.hax-agent/memory/
├── user-preferences-5f8a2b1c.json
├── project-rules-9e3d7f6a.json
└── ...
```

- 每个记忆为独立文件，包含 `name`、`content`、`createdAt`、`updatedAt`。
- 支持通过 `/clear` 清空上下文或 `writeMemory` / `deleteMemory` 管理记忆。

---

## 多 Agent 团队

内置 `auth-refactor` 团队计划，专为认证模块重构设计，包含以下角色：

| 角色 | 职责 |
|------|------|
| 🏗️ **架构师** | 设计整体重构方案与模块划分 |
| 🔐 **Token 专家** | Token 生成、验证、刷新策略 |
| 💾 **Session 专家** | 会话存储与状态管理 |
| 👤 **Identity 专家** | 用户身份与权限模型 |
| 🛡️ **安全审查员** | 安全审计与漏洞排查 |
| 🧪 **测试工程师** | 测试覆盖与集成测试方案 |

运行团队计划：

```bash
npm run auth:team
# 或
hax-agent team auth-refactor
```

---

## 开发与测试

### 运行测试

```bash
npm test
```

项目使用 Node.js 内置 test runner（`node --test`）。测试文件位于 `test/` 目录：

```text
test/
├── agent-engine.test.js          # Agent 引擎行为
├── auth-refactor.test.js         # 认证重构团队
├── cli.test.js                   # CLI 入口与命令
├── config-memory.test.js         # 配置、记忆与上下文
├── context-window.test.js        # 上下文窗口管理
├── desktop-git-assist.test.js    # 桌面端 Git 辅助
├── desktop-main.test.js          # 桌面端主进程
├── desktop-markdown.test.js      # 桌面端 Markdown 渲染
├── desktop-renderer.test.js      # 桌面端渲染器组件
├── desktop-smoke.smoke.js        # 桌面端冒烟测试
├── file-context.test.js          # 文件上下文召回
├── init-wizard.test.js           # 初始化向导
├── orchestration.test.js         # 协调逻辑
├── permissions.test.js           # 权限管理
├── providers.test.js             # AI Provider
├── skills.test.js                # Skills 技能系统
├── team-plan.test.js             # 团队计划格式化
├── team-tools.test.js            # 团队工具
└── updater.test.js               # CLI 自更新
```

### 目录规范

- `src/` — 源码，遵循 CommonJS 模块规范
- `desktop/` — 桌面端源码，与 CLI 共用核心层
- `test/` — 测试文件，与被测模块一一对应
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
