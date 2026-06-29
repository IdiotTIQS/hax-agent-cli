# Anthropic SDK 集成优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 HaxAgent 中 Anthropic SDK 集成的过时模型 ID 与定价、添加 adaptive thinking、引入 prompt caching、并将 tool 调用从自定义 DSML 解析迁移到 SDK 原生 `tool_use` blocks。

**Architecture:** 修改集中在两个 Provider 实现层(`src/api/provider.js` 的 `AnthropicProvider` 与 `src/core/api/provider-adapter.js` 的适配器),保留跨提供商的 DSML 解析作为非 Anthropic 路径的 fallback。系统提示重构为"稳定前缀 + 动态 system-reminder 消息"模式以启用缓存。所有改动通过 `node:test` 单元测试驱动。

**Tech Stack:** Node.js ≥18 · `@anthropic-ai/sdk@^0.91.1` · `node:test` + `node:assert/strict` · 现有 `test-helpers/mocks.js` 手工 mock

---

## 文件结构总览

### 将创建的新文件
| 路径 | 职责 |
|---|---|
| `test/anthropic-provider.test.js` | AnthropicProvider 单元测试(模型、thinking、cache、tool_use) |
| `test/pricing-fix.test.js` | 定价表与模型 ID 修复验证测试 |

### 将修改的现有文件
| 路径 | 修改类别 |
|---|---|
| `src/pricing.js` | Task 1:修复 Opus 4.7 定价、删除幻影模型、修正回退 |
| `src/api/provider.js` | Task 1-4:默认模型、thinking、caching、tool_use |
| `src/core/api/provider-adapter.js` | Task 1-4:同上(新适配器层) |
| `src/tools/image-tools.js` | Task 1:更新默认模型 |
| `src/hooks/registry.js` | Task 1:更新默认模型 |
| `src/config/profiles.js` | Task 1:删除 claude-opus-4-8 引用 |
| `src/setup.js` | Task 1:删除 claude-opus-4-8 引用 |
| `src/engine/agent.js` | Task 3:重构系统提示拆分;Task 4:tool_result 携带 tool_use_id |
| `src/engine/query.js` | Task 3:暴露上下文摘要供独立注入 |

---

## Task 1: 修复模型 ID 与定价表

**Files:**
- Test: `test/pricing-fix.test.js` (新建)
- Modify: `src/pricing.js:11-23`
- Modify: `src/api/provider.js:106,147,153`
- Modify: `src/core/api/provider-adapter.js:186,319-321`
- Modify: `src/tools/image-tools.js:247`
- Modify: `src/hooks/registry.js:118`
- Modify: `src/config/profiles.js:18-21`
- Modify: `src/setup.js:54,63`

### Step 1.1: 编写失败测试 — 定价修正

- [ ] **创建 `test/pricing-fix.test.js`**

```javascript
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PRICING, getPricing } = require("../src/pricing");

test("Opus 4.7 pricing matches official $5/$25 per 1M tokens", () => {
  const p = getPricing("claude-opus-4-7");
  assert.equal(p.input, 5.0, "Opus 4.7 input price should be $5/1M");
  assert.equal(p.output, 25.0, "Opus 4.7 output price should be $25/1M");
  assert.equal(p.cacheWrite, 6.25, "Cache write = 1.25x input");
  assert.equal(p.cacheRead, 0.5, "Cache read = 0.1x input");
});

test("phantom model claude-opus-4-8 is not in pricing table", () => {
  assert.equal(PRICING["claude-opus-4-8"], undefined, "claude-opus-4-8 is not a real model");
});

test("phantom model claude-sonnet-4-7-20250501 is not in pricing table", () => {
  assert.equal(PRICING["claude-sonnet-4-7-20250501"], undefined, "alias with date suffix is invalid");
});

test("Sonnet 4.6 pricing intact at $3/$15", () => {
  const p = getPricing("claude-sonnet-4-6");
  assert.equal(p.input, 3.0);
  assert.equal(p.output, 15.0);
});

test("Haiku 4.5 pricing matches $1/$5", () => {
  const p = getPricing("claude-haiku-4-5-20251001");
  assert.equal(p.input, 1.0, "Haiku 4.5 input should be $1/1M (was $0.8)");
  assert.equal(p.output, 5.0, "Haiku 4.5 output should be $5/1M (was $4)");
});

test("regex fallback for 'claude opus' resolves to claude-opus-4-7", () => {
  const p = getPricing("claude-opus-foo");
  assert.equal(p.input, 5.0);
  assert.equal(p.output, 25.0);
});
```

- [ ] **运行测试确认失败**

执行:`cd E:/HaxAgent && node --test test/pricing-fix.test.js`
预期:多个测试失败(Opus 4.7 价格错误、claude-opus-4-8 仍存在、Haiku 价格不符等)

### Step 1.2: 修复 `src/pricing.js`

- [ ] **编辑 `src/pricing.js` 第 11-23 行**

将整个 Anthropic 区块替换为:

```javascript
  // === Anthropic ===
  // 价格基于 2026-06 官方文档(per 1M tokens, USD)
  "claude-opus-4-7":           { input: 5.0,   output: 25.0,  cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6":           { input: 5.0,   output: 25.0,  cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5-20251101":  { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4-1-20250805":  { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6":         { input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-sonnet-4-5-20250929":{ input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1.0,   output: 5.0,   cacheWrite: 1.25,  cacheRead: 0.1 },
  // 已退役/遗留模型 — 保留定价供历史会话成本计算
  "claude-opus-4-20250514":    { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-20250514":  { input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-3-5-sonnet-20241022":{ input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-3-opus-20240229":    { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-3-5-haiku-20241022": { input: 0.8,   output: 4.0,   cacheWrite: 1.0,   cacheRead: 0.08 },
```

注意:
- 删除 `claude-opus-4-8`(不存在)
- 删除 `claude-sonnet-4-7-20250501`(别名带日期非法)
- Opus 4.7 价格从 $15/$75 改为 $5/$25(原条目错按 Opus 3 定价)
- Haiku 4.5 价格从 $0.8/$4 改为 $1/$5

- [ ] **更新 `src/pricing.js` 第 87 行回退表**

将 `[/claude.*opus/i, "claude-opus-4-7"]` 保留(已正确)。
将 `[/claude.*haiku/i, "claude-haiku-3-5-20241022"]` 修改为:

```javascript
  [/claude.*haiku/i,             "claude-haiku-4-5-20251001"],
```

将 `[/claude.*sonnet/i, "claude-sonnet-4-20250514"]` 修改为:

```javascript
  [/claude.*sonnet/i,            "claude-sonnet-4-6"],
```

- [ ] **运行 pricing 测试确认通过**

执行:`cd E:/HaxAgent && node --test test/pricing-fix.test.js`
预期:所有 6 个测试 PASS

### Step 1.3: 修复 Provider 默认模型

- [ ] **编辑 `src/api/provider.js` 第 106 行**

原:
```javascript
constructor(o = {}) { this.apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY; this.apiUrl = o.apiUrl || "https://api.anthropic.com"; this.model = o.model || "claude-sonnet-4-20250514"; this.maxTokens = o.maxTokens || 8192; }
```

改为:
```javascript
constructor(o = {}) { this.apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY; this.apiUrl = o.apiUrl || "https://api.anthropic.com"; this.model = o.model || "claude-sonnet-4-6"; this.maxTokens = o.maxTokens || 8192; }
```

- [ ] **编辑 `src/api/provider.js` 第 147 行**

原:
```javascript
async listModels() { return [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-8" }, { id: "claude-haiku-4-5-20251001" }]; }
```

改为:
```javascript
async listModels() { return [{ id: "claude-opus-4-7" }, { id: "claude-sonnet-4-6" }, { id: "claude-haiku-4-5-20251001" }]; }
```

- [ ] **编辑 `src/core/api/provider-adapter.js` 第 186 行**

将硬编码的 `"claude-sonnet-4-20250514"` fallback 改为 `"claude-sonnet-4-6"`。

- [ ] **编辑 `src/core/api/provider-adapter.js` 第 319-321 行**(若是上下文窗口或类似配置)

将相同的退役模型字符串替换为当前别名。读取这三行确认原内容后做最小替换。

- [ ] **编辑 `src/tools/image-tools.js` 第 247 行**

将默认模型 `"claude-sonnet-4-20250514"` 替换为 `"claude-sonnet-4-6"`。

- [ ] **编辑 `src/hooks/registry.js` 第 118 行**

将默认模型 `"claude-sonnet-4-20250514"` 替换为 `"claude-sonnet-4-6"`。

### Step 1.4: 清除 `claude-opus-4-8` 引用

- [ ] **编辑 `src/config/profiles.js` 第 21 行**

读取该文件,将 `"claude-opus-4-8"` 替换为 `"claude-opus-4-7"`。

- [ ] **编辑 `src/setup.js` 第 54 行**

读取该文件,将 `"claude-opus-4-8"` 替换为 `"claude-opus-4-7"`。

- [ ] **运行所有测试验证无回归**

执行:`cd E:/HaxAgent && npm test`
预期:所有现有 32 个测试 + 新增 6 个 pricing 测试均 PASS。
若 `test/smoke-test.test.js` 因模型 ID 校验失败,需相应更新其测试 fixture 至 `claude-sonnet-4-6`。

### Step 1.5: 提交 Task 1

- [ ] **创建提交**

```bash
cd E:/HaxAgent
git add src/pricing.js src/api/provider.js src/core/api/provider-adapter.js src/tools/image-tools.js src/hooks/registry.js src/config/profiles.js src/setup.js test/pricing-fix.test.js test/smoke-test.test.js
git commit -m "fix: update retired Claude model IDs and correct Opus 4.7 pricing

- Replace claude-sonnet-4-20250514 (retired 2026-06-15) default with claude-sonnet-4-6
- Remove phantom models claude-opus-4-8 and claude-sonnet-4-7-20250501
- Correct Opus 4.7 pricing from \$15/\$75 to \$5/\$25 per 1M tokens
- Correct Haiku 4.5 pricing from \$0.8/\$4 to \$1/\$5
- Update sonnet regex fallback to current alias"
```

---

## Task 2: 添加 Adaptive Thinking 支持

**Files:**
- Test: `test/anthropic-provider.test.js` (新建)
- Modify: `src/api/provider.js:109-148` (AnthropicProvider.stream)
- Modify: `src/core/api/provider-adapter.js` (Anthropic 适配器部分)

### Step 2.1: 重构 `AnthropicProvider.stream` 暴露请求体构造

`AnthropicProvider.stream` 当前内联构建请求体,使得 thinking 行为不可单元测试。先抽取为可测函数。

- [ ] **编辑 `src/api/provider.js`,在 `AnthropicProvider` 类内添加 `_buildRequestBody` 方法**

在 `_toMessages` 方法之前(约第 134 行)添加:

```javascript
  _buildRequestBody(req) {
    const body = {
      model: req.model || this.model,
      max_tokens: req.maxTokens || this.maxTokens,
      stream: true,
      messages: this._toMessages(req.messages || []),
    };
    if (req.system) body.system = String(req.system);
    if (req.tools?.length) body.tools = req.tools;
    if (req.thinking) {
      body.thinking = { type: "adaptive" };
      const intensity = req.thinkIntensity;
      // effort 进入 output_config(GA,无需 beta header)
      let effort = "high";
      if (intensity === "low" || intensity === "medium" || intensity === "high") effort = intensity;
      else if (intensity === "x-high" || intensity === "xhigh") effort = "xhigh";
      else if (intensity === "max") effort = "max";
      body.output_config = { effort };
    }
    return body;
  }
```

- [ ] **修改 `stream` 方法第 115-120 行**,将内联请求体替换为方法调用

原:
```javascript
      const stream = await withRetry(() => client.messages.create({
        model: req.model || this.model, max_tokens: req.maxTokens || this.maxTokens, stream: true,
        messages: this._toMessages(req.messages || []),
        ...(req.system ? { system: String(req.system) } : {}),
        ...(req.tools?.length ? { tools: req.tools } : {}),
      }, { signal: req.signal }));
```

改为:
```javascript
      const stream = await withRetry(() => client.messages.create(
        this._buildRequestBody(req),
        { signal: req.signal }
      ));
```

### Step 2.2: 编写失败测试 — Adaptive Thinking 请求体

- [ ] **创建 `test/anthropic-provider.test.js`**

```javascript
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AnthropicProvider } = require("../src/api/provider");

test("无 thinking 时请求体不含 thinking/output_config", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-6" });
  const body = p._buildRequestBody({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(body.thinking, undefined);
  assert.equal(body.output_config, undefined);
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.stream, true);
});

test("thinking=true 时设置 adaptive thinking + default high effort", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-opus-4-7" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "solve" }],
    thinking: true,
  });
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "high" });
});

test("thinkIntensity 'low' 映射到 effort=low", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "low",
  });
  assert.equal(body.output_config.effort, "low");
});

test("thinkIntensity 'x-high' 映射到 effort=xhigh(Opus 4.7 专属)", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "x-high",
  });
  assert.equal(body.output_config.effort, "xhigh");
});

test("thinkIntensity 'max' 映射到 effort=max", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "max",
  });
  assert.equal(body.output_config.effort, "max");
});

test("请求体绝不包含 budget_tokens、temperature、top_p、top_k", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "max",
  });
  assert.equal(body.budget_tokens, undefined, "Opus 4.7 移除了 budget_tokens");
  assert.equal(body.temperature, undefined, "Opus 4.7 移除了采样参数");
  assert.equal(body.top_p, undefined);
  assert.equal(body.top_k, undefined);
});
```

- [ ] **运行测试确认前 5 个 PASS、最后 1 个 PASS**(第 6 个测试本应通过,因为我们没有引入这些参数)

执行:`cd E:/HaxAgent && node --test test/anthropic-provider.test.js`
预期:6 个测试均 PASS(因为 Step 2.1 已实现了构建逻辑)

如有失败,检查 Step 2.1 的 `_buildRequestBody` 实现是否完整。

### Step 2.3: 同步更新 `provider-adapter.js`

- [ ] **读取 `src/core/api/provider-adapter.js` 中 Anthropic 适配器部分**(约第 189-300 行)

定位 Anthropic 路径的请求体构造代码。

- [ ] **在 Anthropic 适配器中应用相同的 thinking + effort 逻辑**

按 `_buildRequestBody` 的相同形态,在适配器的请求构造路径中加入:
- `thinking: { type: "adaptive" }` 当 `request.thinking` 为 true
- `output_config: { effort }` 基于 intensity 映射
- 不传 `budget_tokens`、`temperature`、`top_p`、`top_k`

具体行号在读取后确认。

### Step 2.4: 提交 Task 2

- [ ] **创建提交**

```bash
cd E:/HaxAgent
git add src/api/provider.js src/core/api/provider-adapter.js test/anthropic-provider.test.js
git commit -m "feat(anthropic): support adaptive thinking with effort parameter

- Add _buildRequestBody for testable request construction
- Map thinkIntensity (low/medium/high/x-high/max) to output_config.effort
- Use thinking: {type: 'adaptive'} (only supported mode on Opus 4.7)
- Never send budget_tokens, temperature, top_p, top_k (removed on Opus 4.7)"
```

---

## Task 3: 引入 Prompt Caching

**Files:**
- Test: `test/anthropic-provider.test.js` (扩展)
- Modify: `src/engine/agent.js:380-411` (`_buildSystemPrompt`)
- Modify: `src/engine/agent.js:218-264` (`_runToolLoop` 消息注入)
- Modify: `src/api/provider.js:109-148` (`AnthropicProvider.stream` 接受结构化 system)

**关键约束**:当前 `_buildSystemPrompt()` 每轮都重建并注入 `buildContextSummary()`(动态),完全破坏前缀缓存。必须将系统提示拆为:
- **稳定前缀**(角色描述 + 工具使用规范 + 技能列表)→ 携带 `cache_control`
- **每轮动态部分**(当前上下文摘要)→ 作为 `<system-reminder>` 用户消息注入

### Step 3.1: 重构 `_buildSystemPrompt` 拆出稳定/动态部分

- [ ] **编辑 `src/engine/agent.js` 第 380-411 行,替换 `_buildSystemPrompt` 方法**

```javascript
  /** 返回系统提示的稳定前缀(用于提示缓存) */
  _buildStableSystemPrompt() {
    const skillsPrompt = this._getSkillsPrompt();
    return [
      "You are Hax Agent, a professional AI coding assistant with deep expertise in software development.",
      "Think like a senior engineer: deliberate, thorough, security-conscious.",
      "",
      "Core Principles:",
      "- Always read existing files before modifying them.",
      "- Make minimal, focused changes. Preserve existing code style.",
      "- Use tools carefully with valid, non-empty arguments.",
      "- If a tool fails, adapt instead of repeating the same failing input.",
      "- After making changes, verify correctness by reading back the file.",
      "",
      "Tool Usage:",
      "- file.read: Read files. Always read before editing.",
      "- file.write: Create/overwrite files.",
      "- file.edit: Find and replace text in files. Use replace_all:true for all occurrences.",
      "- file.glob: Find files by pattern.",
      "- file.search: Search file contents with regex.",
      "- file.readDirectory: List directory contents.",
      "- file.delete: Delete files (moves to trash by default).",
      "- shell.run: Execute shell commands with arguments array.",
      "- web.fetch: Fetch URL content.",
      "- web.search: Search the web.",
      "- agent: Spawn a sub-agent for ONE truly independent task. Do NOT spawn more than 2-3 agents per turn.",
      "- task.create/get/list/stop: Manage background tasks.",
      skillsPrompt || "",
    ].filter(Boolean).join("\n");
  }

  /** 返回每轮变化的动态上下文摘要,以独立用户消息注入 */
  _buildDynamicContextReminder() {
    const ctx = this._queryContext.buildContextSummary();
    if (!ctx) return null;
    return `<system-reminder>\nCurrent Context:\n${ctx}\n</system-reminder>`;
  }

  /** 兼容性方法:旧调用者仍可获取完整系统提示(不分割) */
  _buildSystemPrompt() {
    const stable = this._buildStableSystemPrompt();
    const dynamic = this._buildDynamicContextReminder();
    return dynamic ? `${stable}\n\n${dynamic}` : stable;
  }
```

### Step 3.2: 修改 `_runToolLoop` 在每轮注入动态 reminder

- [ ] **编辑 `src/engine/agent.js` 第 218-264 行附近**

在 `_runToolLoop` 内,每次调用 `provider.stream()` 前,将动态 context reminder 注入到 messages 末尾:

```javascript
      // 每轮注入动态上下文为 system-reminder(不污染稳定 system 前缀)
      const dynamicReminder = this._buildDynamicContextReminder();
      const msgsWithReminder = dynamicReminder
        ? [...msgs, { role: "user", content: dynamicReminder, internal: true }]
        : msgs;

      // === API Call with bounded tokens ===
      const maxTok = boundedCompletionTokens(ctx.maxTokens, ctx.contextWindowTokens);
      // ...
      for await (const chunk of s.provider.stream({
        messages: msgsWithReminder,
        system: this._buildStableSystemPrompt(),  // 仅稳定前缀
        tools: registry?.toApiSchema() || [],
        signal, maxTokens: maxTok,
        thinking: s._thinking || false,
        thinkIntensity: s._thinkIntensity || null,
        enableCache: s.provider?.name === "anthropic",  // 新参数
      })) {
```

注意:`msgsWithReminder` 是临时数组,不写回 `msgs` 或 `s.messages` — reminder 仅供本轮请求使用。

### Step 3.3: 在 `AnthropicProvider._buildRequestBody` 中添加 cache_control

- [ ] **编辑 `src/api/provider.js` 中 `_buildRequestBody`(Step 2.1 添加的方法)**

修改 system 部分,将字符串系统提示转换为带 `cache_control` 的内容块数组:

```javascript
    if (req.system) {
      // 启用 prompt caching:将 system 转为内容块数组并标记最末块为可缓存
      if (req.enableCache) {
        body.system = [{
          type: "text",
          text: String(req.system),
          cache_control: { type: "ephemeral" },
        }];
      } else {
        body.system = String(req.system);
      }
    }
```

工具列表也是稳定的(每轮相同),由于 Anthropic 缓存按 `tools → system → messages` 顺序匹配前缀,system 上的 `cache_control` 会自动包含 tools 的缓存。

### Step 3.4: 编写测试 — Prompt Caching

- [ ] **追加到 `test/anthropic-provider.test.js`**

```javascript
test("enableCache=true 时 system 被转为带 cache_control 的内容块", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-6" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful.",
    enableCache: true,
  });
  assert.ok(Array.isArray(body.system), "system 应为内容块数组");
  assert.equal(body.system.length, 1);
  assert.equal(body.system[0].type, "text");
  assert.equal(body.system[0].text, "You are helpful.");
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
});

test("enableCache=false 时 system 保持字符串", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-6" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful.",
    enableCache: false,
  });
  assert.equal(typeof body.system, "string");
  assert.equal(body.system, "You are helpful.");
});

test("enableCache 缺省时 system 保持字符串(向后兼容)", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-6" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful.",
  });
  assert.equal(typeof body.system, "string");
});
```

- [ ] **运行测试确认 PASS**

执行:`cd E:/HaxAgent && node --test test/anthropic-provider.test.js`
预期:9 个测试均 PASS(Task 2 的 6 个 + Task 3 的 3 个)

### Step 3.5: 编写测试 — 系统提示结构

- [ ] **创建 `test/engine-system-prompt.test.js`**

```javascript
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentEngine, Session } = require("../src/engine/agent");
const { createMockProvider, createMockToolRegistry } = require("../test-helpers/mocks");

function makeEngine() {
  const session = new Session({
    provider: createMockProvider(),
    toolRegistry: createMockToolRegistry(),
  });
  return new AgentEngine({ session });
}

test("_buildStableSystemPrompt 不包含 Current Context 段", () => {
  const e = makeEngine();
  const stable = e._buildStableSystemPrompt();
  assert.ok(!stable.includes("Current Context:"),
    "稳定前缀不应包含每轮变化的上下文摘要");
});

test("_buildStableSystemPrompt 包含角色与工具说明", () => {
  const e = makeEngine();
  const stable = e._buildStableSystemPrompt();
  assert.ok(stable.includes("Hax Agent"));
  assert.ok(stable.includes("file.read"));
  assert.ok(stable.includes("shell.run"));
});

test("_buildDynamicContextReminder 在无上下文时返回 null", () => {
  const e = makeEngine();
  const reminder = e._buildDynamicContextReminder();
  assert.equal(reminder, null);
});

test("_buildSystemPrompt 在无上下文时等于稳定前缀", () => {
  const e = makeEngine();
  assert.equal(e._buildSystemPrompt(), e._buildStableSystemPrompt());
});
```

- [ ] **运行测试确认 PASS**

执行:`cd E:/HaxAgent && node --test test/engine-system-prompt.test.js`
预期:4 个测试 PASS。

若 `createMockProvider/createMockToolRegistry` 签名不匹配,读取 `test-helpers/mocks.js` 相应导出后调整。

### Step 3.6: 提交 Task 3

- [ ] **创建提交**

```bash
cd E:/HaxAgent
git add src/engine/agent.js src/api/provider.js test/anthropic-provider.test.js test/engine-system-prompt.test.js
git commit -m "feat(anthropic): enable prompt caching with stable system prefix

- Split _buildSystemPrompt into stable prefix + dynamic context reminder
- Inject dynamic context as <system-reminder> user message per turn
- Add cache_control: ephemeral on Anthropic system blocks when enableCache=true
- Stable system + tools now cacheable (~90% cost reduction on repeated turns)"
```

---

## Task 4: 迁移到 SDK 原生 Tool Use

**Files:**
- Modify: `src/api/provider.js:109-148` (`AnthropicProvider.stream`)
- Modify: `src/api/provider.js:134` (`_toMessages`)
- Modify: `src/engine/agent.js:289-361` (tool result 携带 id)
- Test: `test/anthropic-provider.test.js` (扩展)
- Test: `test/engine-tool-result.test.js` (新建)

**关键约束**:
- **保留 DSML** 供非 Anthropic 提供商使用(跨提供商一致协议)
- 仅在 Anthropic 路径增加 native tool_use 解析
- engine 的 `tool_result` 输出需携带 `tool_use_id`(目前为 OpenAI 风格无 id 字符串)
- `_toMessages` 必须为 Anthropic 转换 tool_result 为 block 格式

### Step 4.1: 让 engine 在 tool_result 中携带 tool_use_id

- [ ] **编辑 `src/engine/agent.js` 第 357 行附近**

读取当前实现:
```javascript
results.push({ type: "tool_result", content: JSON.stringify(execResult) });
```

改为:
```javascript
results.push({
  type: "tool_result",
  tool_use_id: tu.id || null,
  tool_name: name,
  content: JSON.stringify(execResult),
});
```

`tu.id` 由 provider 在 `tool_uses` 事件中返回(OpenAI 路径已带,DSML 路径目前无 id — 需为 DSML 也生成合成 id)。

- [ ] **编辑 `src/api/provider.js` `AnthropicProvider._parseDsml` 第 136-145 行**

为 DSML 解析的每个 toolUse 生成合成 id:

```javascript
  _parseDsml(text) {
    const re = /｜｜DSML｜｜invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
    const uses = []; let m; let i = 0;
    while ((m = re.exec(text)) !== null) {
      const p = {}; const pr = /｜｜DSML｜｜parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g; let pm;
      while ((pm = pr.exec(m[2])) !== null) p[pm[1]] = pm[2].trim();
      uses.push({ id: `dsml_${Date.now()}_${i++}`, name: m[1], input: p });
    }
    return uses;
  }
```

### Step 4.2: 在 `AnthropicProvider.stream` 中捕获 native tool_use 流

- [ ] **编辑 `src/api/provider.js` 第 109-132 行**,扩展事件处理

将整个 `stream` 方法的 for-await 循环替换为:

```javascript
    // 累积 native tool_use 块(按 content_block index 索引)
    const nativeToolUses = {}; // index -> { id, name, input_acc: string }

    try {
      const stream = await withRetry(() => client.messages.create(
        this._buildRequestBody(req),
        { signal: req.signal }
      ));

      for await (const e of stream) {
        if (e.type === "content_block_start") {
          if (e.content_block?.type === "tool_use") {
            nativeToolUses[e.index] = {
              id: e.content_block.id,
              name: e.content_block.name,
              input_acc: "",
            };
            yield { type: "thinking" };  // UI hint
          }
        } else if (e.type === "content_block_delta") {
          if (e.delta?.type === "text_delta") {
            text += e.delta.text;
            yield { type: "text", delta: e.delta.text };
          } else if (e.delta?.type === "input_json_delta" && nativeToolUses[e.index]) {
            nativeToolUses[e.index].input_acc += e.delta.partial_json || "";
          }
        } else if (e.type === "message_delta") {
          usage = e.usage;
        }
      }
    } catch (err) { yield { type: "error", message: err.message }; return; }

    if (usage) yield {
      type: "usage",
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    };

    // 优先使用 native tool_use,无则回退 DSML
    const nativeUses = Object.values(nativeToolUses).map(t => {
      let input = {};
      try { input = JSON.parse(t.input_acc || "{}"); } catch (_) {}
      return { id: t.id, name: t.name, input };
    });

    const toolUses = nativeUses.length > 0 ? nativeUses : this._parseDsml(text);
    yield { type: "tool_uses", toolUses, text, usage };
  }
```

### Step 4.3: 让 `_toMessages` 为 Anthropic 转换 tool_result 块

- [ ] **编辑 `src/api/provider.js` 第 134 行 `_toMessages` 方法**

替换为:

```javascript
  _toMessages(msgs) {
    return msgs.map(m => {
      // tool_result 数组消息 → Anthropic content blocks
      if (m.role === "user" && Array.isArray(m.content)) {
        const blocks = m.content.map(c => {
          if (c.type === "tool_result") {
            return {
              type: "tool_result",
              tool_use_id: c.tool_use_id,
              content: typeof c.content === "string" ? c.content : JSON.stringify(c.content),
            };
          }
          return c;
        });
        return { role: "user", content: blocks };
      }
      // assistant 消息含 tool_use 历史 → 还原为 Anthropic 块
      if (m.role === "assistant" && m.tool_uses?.length) {
        const blocks = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tu of m.tool_uses) {
          blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        }
        return { role: "assistant", content: blocks };
      }
      return { role: m.role, content: m.content };
    });
  }
```

### Step 4.4: 让 engine 在 assistant 消息中记录 tool_uses

- [ ] **编辑 `src/engine/agent.js` 第 289-291 行**

原:
```javascript
      var aMsg = { role: "assistant", content: text };
      if (reasoningText) aMsg.reasoning_content = reasoningText;
      msgs.push(aMsg);
```

改为:
```javascript
      var aMsg = { role: "assistant", content: text };
      if (reasoningText) aMsg.reasoning_content = reasoningText;
      if (toolUses.length) aMsg.tool_uses = toolUses;  // 保留 id 供后续转换
      msgs.push(aMsg);
```

### Step 4.5: 编写测试 — Native Tool Use 解析

- [ ] **追加到 `test/anthropic-provider.test.js`**

由于 `stream()` 内部 `new Anthropic(...)` 难以直接 mock,我们测试 `_toMessages` 与 `_parseDsml` 的转换逻辑:

```javascript
test("_toMessages 将 tool_result 转换为 Anthropic 块格式", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const result = p._toMessages([
    { role: "user", content: "list files" },
    { role: "assistant", content: "ok", tool_uses: [{ id: "tu_1", name: "file.glob", input: { pattern: "*.js" } }] },
    { role: "user", content: [
      { type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' }
    ]},
  ]);

  assert.equal(result.length, 3);
  // assistant 应转换为 [text, tool_use]
  assert.ok(Array.isArray(result[1].content));
  assert.equal(result[1].content[0].type, "text");
  assert.equal(result[1].content[1].type, "tool_use");
  assert.equal(result[1].content[1].id, "tu_1");
  // user tool_result 应保留 tool_use_id
  assert.equal(result[2].content[0].tool_use_id, "tu_1");
});

test("_parseDsml 为每个 invoke 生成唯一 id", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const ZWSP = "｜｜";  // full-width vertical bars
  const text = `${ZWSP}DSML${ZWSP}invoke name="x">${ZWSP}DSML${ZWSP}parameter name="a">1</${ZWSP}DSML${ZWSP}parameter></${ZWSP}DSML${ZWSP}invoke>` +
               `${ZWSP}DSML${ZWSP}invoke name="y">${ZWSP}DSML${ZWSP}parameter name="b">2</${ZWSP}DSML${ZWSP}parameter></${ZWSP}DSML${ZWSP}invoke>`;
  const uses = p._parseDsml(text);
  assert.equal(uses.length, 2);
  assert.ok(uses[0].id.startsWith("dsml_"));
  assert.ok(uses[1].id.startsWith("dsml_"));
  assert.notEqual(uses[0].id, uses[1].id, "两次 invoke 应有不同 id");
});

test("_toMessages 处理无 tool_uses 的 assistant 消息(向后兼容)", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const result = p._toMessages([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  assert.equal(result[1].content, "hello", "无 tool_uses 时保持原始字符串内容");
});
```

- [ ] **运行测试确认 PASS**

执行:`cd E:/HaxAgent && node --test test/anthropic-provider.test.js`
预期:12 个测试均 PASS(Task 2:6 + Task 3:3 + Task 4:3)

### Step 4.6: 编写测试 — Engine Tool Result 携带 ID

- [ ] **创建 `test/engine-tool-result.test.js`**

```javascript
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Session, AgentEngine } = require("../src/engine/agent");

// 内联 mock provider:发出一次 tool_use 后结束
function makeStubProvider() {
  return {
    name: "anthropic",
    model: "claude-sonnet-4-6",
    async *stream(req) {
      yield { type: "tool_uses", toolUses: [{ id: "tu_abc", name: "file.read", input: { path: "/a" } }], text: "", usage: null };
    },
  };
}

function makeStubRegistry() {
  return {
    toApiSchema: () => [{ name: "file.read", description: "", input_schema: { type: "object" } }],
    get: () => ({ isReadOnly: () => true }),
    execute: async () => ({ ok: true, data: { content: "file content" } }),
  };
}

test("tool_result 携带 tool_use_id 来自 provider 的 tool_uses.id", async () => {
  const session = new Session({
    provider: makeStubProvider(),
    toolRegistry: makeStubRegistry(),
  });
  const engine = new AgentEngine({ session, maxToolTurns: 1 });

  for await (const _ of engine.sendMessage("read /a")) { /* drain */ }

  // 找到 messages 中的 tool_result 消息
  const last = session.messages.find(m =>
    m.role === "user" && Array.isArray(m.content) &&
    m.content.some(c => c.type === "tool_result")
  );
  assert.ok(last, "应存在 tool_result 消息");
  const tr = last.content.find(c => c.type === "tool_result");
  assert.equal(tr.tool_use_id, "tu_abc", "tool_use_id 应等于 provider 返回的 id");
});
```

- [ ] **运行测试**

执行:`cd E:/HaxAgent && node --test test/engine-tool-result.test.js`
预期:1 个测试 PASS。

若失败,检查 Step 4.1 中 engine 是否正确从 `tu.id` 取值,以及 `s.messages.push(...msgs.slice(-2))` 是否正确同步。

### Step 4.7: 跨提供商回归测试

- [ ] **运行完整测试套件验证未破坏 OpenAI/DeepSeek 路径**

执行:`cd E:/HaxAgent && npm test`
预期:全部测试 PASS,包括原有 32 个 + 新增 ~16 个。

`BaseOpenAICompatible` 路径未被修改,其 `_toMessages` 内联实现在第 83-98 行,不与本次 Anthropic 修改共享代码,应无回归。

### Step 4.8: 提交 Task 4

- [ ] **创建提交**

```bash
cd E:/HaxAgent
git add src/api/provider.js src/engine/agent.js test/anthropic-provider.test.js test/engine-tool-result.test.js
git commit -m "feat(anthropic): use native SDK tool_use blocks; DSML kept as fallback

- AnthropicProvider.stream() now captures content_block_start/delta for tool_use
- Accumulate input_json_delta into JSON-parseable tool input
- _toMessages converts engine tool_result entries to Anthropic block format
- Engine pipes tool_use_id through tool_result for round-trip correctness
- DSML retained as fallback when model emits text-format tool calls
- Other providers (OpenAI, DeepSeek, etc.) unaffected"
```

---

## 验证(端到端)

### 离线验证(单元测试)

- [ ] **运行完整套件**

```bash
cd E:/HaxAgent && npm test
```

预期所有测试 PASS,包括新增:
- `test/pricing-fix.test.js` (6 个)
- `test/anthropic-provider.test.js` (12 个)
- `test/engine-system-prompt.test.js` (4 个)
- `test/engine-tool-result.test.js` (1 个)
- 共 +23 个新测试

### 在线验证(真实 API 调用)

需要有效 `ANTHROPIC_API_KEY`。

- [ ] **验证模型 ID 修复**

```bash
cd E:/HaxAgent && node src/cli.js --provider anthropic --model claude-sonnet-4-6 -p "ping"
```

预期:成功返回响应(确认默认模型有效)。

- [ ] **验证 thinking + effort**

```bash
cd E:/HaxAgent && node src/cli.js --provider anthropic --model claude-opus-4-7 -p "/think high" --then "解决 2+2 并解释"
```

预期:响应中包含 thinking 块。

- [ ] **验证 prompt caching**

启动会话并发送两条相似消息:

```bash
cd E:/HaxAgent && node src/cli.js --provider anthropic --model claude-sonnet-4-6
> 列出 src/ 下的文件
> 现在列出 test/ 下的文件
> /cost
```

`/cost` 输出应显示第二轮的 `cache_read_input_tokens > 0`,证明缓存命中。

- [ ] **验证 tool_use round-trip**

```bash
cd E:/HaxAgent && node src/cli.js --provider anthropic --model claude-sonnet-4-6 -p "读取 package.json 第 1 行"
```

预期:成功调用 `file.read`,返回正确内容。检查日志确认未触发 DSML fallback。

### 性能与成本验证

- [ ] **对比缓存前后成本**

在第二条消息后查看 `/cost`,预期 `cacheReadTokens` 占 input 的 >70%,对应成本应远低于无缓存基线(理论 ~90% 折扣)。

---

## 风险与回退

| 风险 | 缓解 |
|---|---|
| `_buildRequestBody` 抽取破坏现有 stream 行为 | Task 2 测试覆盖请求体结构;Task 4 在线验证 round-trip |
| 系统提示拆分导致行为漂移 | 保留 `_buildSystemPrompt()` 兼容方法;两部分内容合起来与原版语义一致 |
| Native tool_use 与 DSML 混杂 | 优先级:有 native uses 时忽略 DSML;无则回退 |
| `cache_control` 在小提示(<2048 tokens)上静默不缓存 | 不会报错,只是无缓存效果;`/cost` 可观测 `cache_creation_input_tokens` 为 0 即知 |
| 现有 smoke-test 使用退役模型字符串 | Task 1 包含同步更新 test fixture |

任一 task 出问题:`git revert <task-commit-sha>` 即可回退,各 task 提交独立。

---

## 完成定义

1. 所有新增测试 PASS,现有 32 个测试无回归
2. 默认模型字符串在所有 caller 位置均为有效别名
3. 启用 thinking 时请求体含 `thinking: {type: "adaptive"}` 与 `output_config.effort`
4. 多轮对话中 `/cost` 显示 `cacheReadTokens > 0`
5. Anthropic 提供商下工具调用通过 native tool_use,日志不显示"DSML fallback"
6. 4 个独立提交,每个 task 一次
