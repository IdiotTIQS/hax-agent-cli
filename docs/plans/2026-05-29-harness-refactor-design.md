# HaxAgent Harness 重构设计文档

**日期:** 2026-05-29  
**目标:** 将 HaxAgent 从"功能目录集合"重构为收敛的 harness 内核  
**参考:** OpenHarness (`.audit/OpenHarness/`)

---

## 核心诊断

### 问题 1: Provider 承担了 Agent Loop
`agent-engine.js` 调 `session.provider.stream(...)`，但 `anthropic/openai/google-provider.js` 各自实现完整 tool loop（~370+ lines each），包括 tool limit、tool result 拼接、空工具前言处理。共约 1000 行重复代码。

### 问题 2: 模块数量膨胀
src/ 约 560 JS 文件、112 一级目录、94 大文件。vs OpenHarness 229 文件、30 目录。index.js 是巨型 re-export，"功能目录集合"而非收敛内核。

### 问题 3: 权限模型粒度偏粗
只有工具名 + shell 命令级别。缺少 mode、allowed/denied tools、path rules、denied commands、敏感路径保护。

### 问题 4: 插件系统安全边界弱
直接 require() JS 插件。缺少 manifest 驱动、项目插件默认受控。

### 问题 5: 缺 MCP 作为一等能力
无 src/mcp 实现。

---

## 目标架构

```
src/
  core/
    engine/          # 唯一 agent loop (QueryEngine)
    api/             # provider client adapter，只负责 model I/O
    messages/        # 标准消息、tool_use、tool_result 格式
    tools/           # BaseTool、ToolRegistry、ToolExecutionContext
    permissions/     # mode、path rules、command rules、sensitive path
    hooks/           # PreToolUse/PostToolUse/UserPrompt/Stop
    config/          # typed settings + migrations
    memory/          # transcript、session memory、durable memory
    prompts/         # system prompt/context assembly
  extensions/
    skills/
    plugins/
    commands/
    agents/
  integrations/
    mcp/
    desktop/
    providers/
  cli/
  desktop/
```

---

## 重构路线 (7 阶段)

### Phase 1: 抽出统一 QueryEngine
- 新建 `src/core/engine/query-engine.js`，统一 tool loop
- Provider 改为只暴露 `streamMessage({ model, messages, system, tools, maxTokens, signal })`
- AgentEngine 只负责 session 生命周期和事件转发

### Phase 2: 标准化消息与事件
- 定义统一事件: AssistantTextDelta、ToolExecutionStarted、ToolExecutionCompleted 等
- CLI/desktop/batch/测试 消费同一套 stream events

### Phase 3: 重做 Tool Contract
- BaseTool、inputSchema、isReadOnly(args)、execute(args, context)
- 权限检查由 QueryEngine 统一调用

### Phase 4: 权限和 hooks 合并进核心链路
- PreToolUse -> PermissionChecker -> Tool.execute -> PostToolUse
- 插件 hook 可返回 blocked

### Phase 5: 插件系统迁移
- manifest 优先，JS plugin 保留为高级模式
- 项目级插件默认禁用

### Phase 6: 引入 MCP
- 新增 src/integrations/mcp，支持 stdio 和 HTTP transport

### Phase 7: dry-run / doctor 2.0
- 不调用模型、不执行工具，只解析配置，输出 ready/warning/blocked

---

## Phase 1 详细设计

### Provider 新接口

```javascript
// providers only do model I/O, no tool loop
class ChatProvider {
  async *streamMessage({
    model,
    messages,      // StandardMessage[]
    system,        // string | null
    tools,         // ToolDefinition[]
    maxTokens,
    signal,
  }): AsyncGenerator<StreamEvent>
}
```

### StreamEvent 类型

```javascript
const StreamEventType = {
  TEXT_DELTA: 'text_delta',
  THINKING_DELTA: 'thinking_delta',
  TOOL_USE_START: 'tool_use_start',
  TOOL_USE_DELTA: 'tool_use_delta',
  MESSAGE_START: 'message_start',
  MESSAGE_COMPLETE: 'message_complete',
  USAGE: 'usage',
  ERROR: 'error',
};
```

### QueryEngine 核心循环

```javascript
class QueryEngine {
  async *run({
    apiClient,       // ChatProvider instance
    toolRegistry,    // ToolRegistry instance
    permissionChecker, // PermissionChecker instance
    hookExecutor,    // HookExecutor instance
    messages,        // initial messages
    system,          // system prompt
    maxTurns,        // default 25
    signal,
  }): AsyncGenerator<QueryEvent>
}
```

循环逻辑:
1. Auto-compaction check
2. streamMessage() from API client → accumulate text + tool_uses
3. If no tool_uses → return with final text
4. For each tool_use:
   a. PreToolUse hook
   b. Permission check
   c. Tool.execute()
   d. PostToolUse hook
5. Append tool results → loop

### 向后兼容

Phase 1 保持向后兼容:
- `agent-engine.js` 先用旧的 provider.stream() 路径
- 新 `QueryEngine` 通过 feature flag 启用
- 旧 provider 代码保留，逐步迁移
