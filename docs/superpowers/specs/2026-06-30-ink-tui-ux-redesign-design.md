# 设计：ink TUI UX 大幅提升（中等量级）

- 日期：2026-06-30
- 分支：master（迁移 A–F 已合入）
- 参考：`E:\claude-code-main`（逆向 Claude Code CLI，TS+ESM+React/ink）
- 范围量级：**中等**——布局红利 + 5 项高价值交互重做，组件改造为**原生 ink 元素**（支持 CJK 对齐）

## 目标

在已完成的 ink 迁移底座（`src/tui-ink/`，F1–F6）之上，把"功能对等"的 TUI 提升为现代 TUI 体验。5 项全做：
1. 固定三段式布局 + `<Static>` 提交历史（长会话性能）
2. 工具调用折叠/展开（全局 ctrl+r 精简/详细切换）
3. 菜单式审批（Select 替代 `[Y/n/a]` 一行）
4. 斜杠命令面板（Select 下拉替代纯文本补全）
5. 富状态栏 + context 可视化

所有关键展示组件从 **ANSI-passthrough 改造为原生 ink**（`<Box>`/`<Text color>`），以获得正确的 CJK/emoji 对齐与布局测量。

## 架构方向：A+C 融合

- **A（原地演进）**：在现有 `src/tui-ink/` 上改，复用 F1 的类型契约（AgentEvent/AppState/reducer 骨架）与 F5 已验证的引擎接线 + 审批桥（setImmediate 延迟 resolve + 一次性守卫）。
- **C（先建 ui 原语层）**：新增 `src/tui-ink/ui/`，照搬参考库 `components/ui/` 模式提供可复用原语，因为审批菜单（项3）、命令面板（项4）依赖 select 原语，状态栏（项5）依赖 useTerminalSize。
- 不浪费已验证的引擎/审批逻辑；干净实现 5 项交互。

## 不做（超出中等量级，明确排除）

- 自实现可滚动 scrollback viewport（依赖终端原生 scrollback）
- 全屏 alt-screen 布局重构、vim 模式集成、fork ink
- 参考库 FileEditToolDiff 的异步分块大文件扫描（我们直接用工具结果已有的 diff 数据）
- multi-select、TreeSelect 分组（命令用扁平 Select 即可）

---

## 模块 1：UI 原语层（新增 `src/tui-ink/ui/`）

纯原生 ink，无 ANSI passthrough，自带 CJK 对齐。

- **`useTerminalSize()`**（hook）：返回 `{ columns, rows }`，监听 `process.stdout.on("resize")`，带防抖；卸载时清理监听。状态栏/diff/历史宽度依赖它。
- **`Separator`**：`<Text dimColor> │ </Text>`，状态栏分隔。
- **`Select`**：单选菜单。props `{ items: {label, value, description?, hint?}[]; onSelect; isFocused?; initialIndex? }`。↑↓ 导航、Enter 确认、高亮当前项、可选首字母快捷键（hint 如 y/n/a）。基于参考库 `CustomSelect/use-select-state` 精简版（不含 multi-select）。用于审批菜单 + 命令面板。
- 最小单测：Select 的导航（wrap-around）、确认回调、首字母快捷选中（纯逻辑可测，渲染靠 preview）。

## 模块 2：布局骨架（重写 `App.tsx` 渲染结构）

固定三段式：

```
<Box flexDirection="column">
  <Static items={committedTurns}>{turn => <ConversationTurn turn={turn}/>}</Static>   // 已完成轮:渲染一次,不再 diff
  <Box flexDirection="column">                          // 活动区:仅当前轮重渲染
    <ThinkingBlock/> <ToolList/> <TextStream/> <SpinnerLine/>
  </Box>
  {pendingApproval ? <ApprovalPrompt/> : commandPalette?.open ? <CommandPalette/> : null}  // 覆盖层互斥
  <ErrorLine/> <StatusMessage/>
  <Box flexDirection="column">                           // 底部常驻
    <UserInput/> <StatusBar/>
  </Box>
</Box>
```

- **`<Static>` 提交模型**：每轮 `turn.completed`（及 `turn.interrupted`）把该轮快照（user 文本 + assistant 文本 + tools[] + thinking）作为一个 `CommittedTurn` 推入列表，由 `<Static>` 渲染——ink 对 Static 项只渲染一次、之后不 diff，长会话不卡。活动轮单独实时重渲染，完成后转入 Static。
- **`ConversationTurn`**（新组件）：渲染一个已完成轮次的最终快照（复用展示子组件，但不动画）。
- 输入区 + 状态栏靠 flex 固定在底部（不用绝对定位）。
- 非 fullscreen 模式下 `<Static>` 输出追加到滚动区上方，终端原生 scrollback 可上翻；不自实现 viewport。

## 模块 3：工具调用折叠/展开 + diff

- **`ToolCall`**（改造为原生 ink）：折叠为一行 `<图标> <标签> <输入摘要><耗时>`。图标 `⟳`黄/`✓`绿/`✗`红。原生 `<Box>`/`<Text color>`，不塞 ANSI。
- **展开交互（已定 A）**：全局 `ctrl+r` 切换 `detailMode`（精简 ↔ 详细）。精简模式：工具折叠成一行、隐藏 diff/长输出;详细模式：显示 diff/错误/输出。无 per-item focus（避免终端 focus 复杂度）。
- **`ToolList`**：连续同名工具折叠成 `✓ Read×3`（渲染层逻辑,不入 reducer）;否则逐行。
- **`DiffView`**（新组件）：对 file.write/file.edit 类工具,用工具结果里已有的 diff 数据（或 `formatFileModificationNotice` 的 +/- 数据）渲染:虚线上下边框 frame（参考 DiffFrame）、`+`绿/`-`红行、行号。不做异步分块扫描。

## 模块 4：命令面板 + 菜单式审批

- **`CommandPalette`**（新组件,基于 `Select`）：输入以 `/` 开头时,在输入框上方弹出选择菜单。候选来自 `computeCompletions`（F4 纯函数,前缀匹配）。每项显示命令名 + description（从 command registry 取）。↑↓ 导航、Enter 填入输入框、Esc 关闭。fuzzy 仅在简单时加,否则保持前缀匹配（YAGNI）。
- **`ApprovalPrompt`**（改造,基于 `Select`）：`[Y/n/a]` 一行 → 聚焦选择菜单（批准/始终批准/拒绝,带 y/a/n 首字母快捷键）。file.edit 类审批菜单内嵌 `DiffView` 显示将执行的改动。
  - **必须保留 F4 已验证的正确性**：`setImmediate` 延迟 resolve、一次性 `resolvedRef` 守卫、`wrappedResolve` 同时 resolve 引擎 Promise 并 dispatch `set_approval(null)`。Select 仅替换"读取答案"的 UI 层,底层审批桥（F5）与延迟机制不变。

## 模块 5：富状态栏 + reducer/键盘改动

- **`StatusBar`**（重写,基于 BuiltinStatusLine 模式）：原生 ink `<Box>` + `Separator`,响应式（useTerminalSize,窄屏隐藏次要字段）。字段：`<model> │ <mode> │ Context <pct>% (<used>/<window>) │ $<cost> │ <turns>turns`。context 配迷你进度条（色块按比例,接近满变红;参考 ContextVisualization 精简）。mode 实时反映 Shift+Tab 切换。数据全来自 AppState。

### Reducer / types 改动
- `AppState.messages` → `committedTurns: CommittedTurn[]`（每轮快照:userText / assistantText / tools[] / thinking）。`turn.completed`/`turn.interrupted` 推入。
- 新增 `detailMode: boolean`（ctrl+r）。
- 新增 `commandPalette: { open: boolean; query: string } | null`。
- 新 actions：`commit_turn`、`toggle_detail`、`open_palette`/`close_palette`/`update_palette`。
- 工具同名折叠在渲染层（ToolList）,不入 reducer。

### 键盘改动（`keybindings.tsx`）
- 保留：Shift+Tab（切模式）、Ctrl+L（清屏）、Ctrl+C（中断/双击退出）。
- 新增：`Ctrl+R`（切 detailMode）。
- 命令面板/审批菜单打开时,全局键盘 inert（沿用 F4 的 isActive 互斥模式）;面板内 ↑↓/Enter/Esc 由 Select 自己处理。

---

## 测试策略

- **单测**：reducer 新 action（commit_turn / toggle_detail / palette open-close-update）、Select 导航逻辑（wrap、首字母）、computeCompletions（已有）。
- **门禁**：tsc 双配置 strict 0、全测试 0 fail、`node dist/cli.js --version` 可运行、`--legacy` 路径不破坏。
- **preview harness**：每个新/改组件配 mock-prop 预览（StatusBar/ToolCall/DiffView/Select/CommandPalette/ApprovalPrompt/ConversationTurn）。
- **诚实声明（沿用 F6）**：真实交互（键盘导航、菜单审批、流式渲染、ctrl+r 切换、resize、CJK 对齐目测）需**人工 TTY 测试**——agent 无法驱动交互式终端。spec 与最终报告均明确列出人工验证清单。

## 实施顺序（依赖拓扑,叶子→根）

1. **UI 原语层**（useTerminalSize / Separator / Select）+ 单测——其它都依赖
2. **富状态栏**（StatusBar 重写,依赖 useTerminalSize/Separator）
3. **工具 + diff**（ToolCall 原生化 / ToolList 折叠 / DiffView / detailMode）
4. **布局骨架**（App 三段式 + Static + ConversationTurn + reducer committedTurns 改造）
5. **命令面板**（CommandPalette,依赖 Select）
6. **菜单审批**（ApprovalPrompt 改造,依赖 Select + DiffView,保留 F4/F5 审批桥）
7. **键盘整合 + 收尾**（Ctrl+R 接线、互斥、preview 汇总、cli cast 复查、人工测试清单）

每步独立可验证、可提交,沿用 subagent 实现+审查回环。`--ink` 路径全程可跑,`--legacy` 始终保留。

## 风险

- **R1 `<Static>` 与活动轮的衔接**：committedTurns 推入时机若错,会重复渲染或丢失末轮。reducer commit_turn 单测覆盖时序。
- **R2 审批桥回归**：改 ApprovalPrompt 为 Select 时若破坏 setImmediate/守卫,会导致引擎挂起或双 resolve。改造时保持桥接层不变,仅换 UI;F4 的守卫保留。
- **R3 CJK 对齐**：原生 ink 依赖 string-width;preview 里放中文样例目测,真实需人工 TTY。
- **R4 交互无法自动测**：最大局限,靠 preview + 人工清单缓解。
