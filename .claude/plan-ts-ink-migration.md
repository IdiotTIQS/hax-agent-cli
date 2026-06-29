# 实施计划：全仓迁移 TypeScript + ESM，再用 ink 重构 TUI

## 目标与决策

用户已确认两个决策：
1. **接受引入构建步骤**（发布时 build，dev 用 tsx 即时转译保持近 `node src/cli.js` 体验）
2. **全仓 .ts + 全 ESM** 路线（最彻底，为 ink 铺平道路，因 ink 是 ESM）

最终形态：现代 TS + ESM 代码库 → 在此之上用 ink 重写交互层。

## 现状勘察结论（已确认）

- `src/` **157** 个 .js，全 CommonJS；`test/` **11** 个；`scripts/` **4** 个
- **无运行时拼路径的动态 require**（好）；但有 1 处准动态：`channels/impl/manager.js:13` `require("./"+name)`
- 大量**懒 require**（条件内/函数内）：cli.js、registry.js、commands、channels 等
- `__dirname/__filename` 仅 **2 处**（好）
- JSON require 3 处：cli.js、registry.js、renderer.js
- desktop：主进程 CJS、renderer 已 ESM（Vue）；复用 `src/`
- 已有 `tsconfig.json`（checkJs 护栏）+ `esbuild`（vite 带入）；react/ink/tsx 未装
- 渲染层零测试；总测试 118 全绿（基线）
- 渲染层现状：`renderer.js`(669) + `renderer-markdown`(282) + `renderer-terminal`(98) + `tui/index.js`(230) + `paste-utils`(24)，cli.js 实际驱动 `ResponseRenderer`，事件 switch 在 cli.js 重复 3 次

## 总体策略：先 TS/ESM 全量迁移（阶段 A–D），再 ink 重构（阶段 E–F）

每个阶段独立可验证、可提交、可回退。**不一次性大爆炸**。

---

## 阶段 A — 构建底座（不改业务代码）

目标：建立 TS+ESM 的编译/运行/测试管线，src 仍是 .js 但走新管线跑通。

1. 安装 devDeps：`typescript`(已有)、`tsx`（dev 即时运行）、`@types/node`(已有)
2. 新建 `tsconfig.build.json`：
   - `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: ES2022`
   - `outDir: "dist"`, `rootDir: "src"`, `declaration: false`, `sourceMap: true`
   - 先 `allowJs: true`（让 .js 和 .ts 共存，渐进迁移）
3. `package.json` 改造：
   - 加 `"type": "module"`（全仓 ESM 开关）⚠️ 这一步会让所有 .js 被当 ESM，需配合 A.4
   - `scripts`: `build: tsc -p tsconfig.build.json`、`dev: tsx src/cli.js`、`start: node dist/cli.js`
   - `bin`: `./dist/cli.js`、`main`: `dist/index.js`
   - `prepublishOnly: npm run build && npm test`
   - `files`: 加 `dist/**`，移除 `src/**/*.js`
4. 因为 `"type":"module"` 会立刻破坏所有 CJS .js——**阶段 A 末尾不开 `"type":"module"`**，改为：保持 CJS 跑通构建管线，在阶段 B 逐目录转 ESM 后再翻开关。修正顺序见下。
5. 验证：`npm run build` 产出 dist（此时编译 .js）；`npm test` 仍绿

**A 阶段提交点**：构建管线就位，运行方式暂不变。

---

## 阶段 B — CommonJS → ESM（逐目录，叶子优先）

核心体力活。按依赖拓扑**从叶子模块向入口**推进，每目录一组提交。

转换规则（每文件）：
- `const x = require('y')` → `import x from 'y'` / `import { a } from 'y'`
- `module.exports = {...}` → `export {...}` / `export default`
- 相对 import 补 `.js` 扩展名（NodeNext 强制）⚠️ 量大，可脚本辅助
- `__dirname` → `import.meta.dirname`（Node 20+）或 `fileURLToPath`（2 处）
- JSON：`import data from './x.json' with { type: 'json' }`（3 处）
- 懒 require（条件/函数内）→ `await import()`（传染 async）或提到顶层静态 import；逐个判断
- `channels/impl/manager.js:13` 准动态 require → 显式映射表 + 静态 import（11 个 channel 列举）

推进批次（叶子→根）：
1. 无内部依赖的工具层：shared/、utils/、core/messages、core/api
2. 中间层：api/、auth/、memory/、hooks/、pricing、config/
3. 服务层：services/、channels/、tools/、engine/
4. 上层：commands/、coordinator/、swarm/、bridge/、state/、context/session
5. 入口：index.js、cli.js
6. 入口全转完后，翻开 `package.json` 的 `"type": "module"`

每批：转换 → `npm run build` → 跑相关测试。**先不改 .js→.ts 扩展名**，只改模块语法（减少单步变量）。

**B 阶段提交点**：每个批次一个提交（约 5-6 个提交）。

---

## 阶段 C — .js → .ts 扩展名 + 补类型

ESM 跑通后，逐目录重命名 .js→.ts 并把 JSDoc 类型迁为 TS 原生类型。

1. `git mv` 重命名（保留历史），同批更新引用扩展名
2. 现有 JSDoc `@typedef`/`@param` → TS `interface`/类型注解（很多已在护栏阶段写好）
3. 测试文件 .js → .ts（11 个）
4. tsconfig 收紧：关 `allowJs`，逐步开 `noImplicitAny` → `strict`
5. 验证：`tsc -p tsconfig.build.json` 零错误 + 测试全绿

**C 阶段提交点**：逐目录提交。

---

## 阶段 D — 测试与发布链路收尾

1. 测试运行器适配 ESM/TS：`node --test` + tsx，或迁 vitest（评估）
2. CI/lint 脚本更新（`scripts/lint.js` 适配）
3. 验证 `npm run build` → `npm pack` → 全新环境 `node dist/cli.js` 可跑
4. 确认 desktop 主进程仍能 require/import dist（边界验证）

**D 阶段提交点**：TS+ESM 迁移完成，118 测试全绿，可发布。

---

## 阶段 E — ink 接入底座（TUI 重构第一步）

TS+ESM 就绪后，ink 无缝接入。

1. 安装：`ink`、`react`、`@types/react`
2. tsconfig 开 `jsx: "react"`（或 `react-jsx`），新增 `.tsx` 支持
3. esbuild/tsc 处理 JSX（已在构建管线内）
4. 建一个最小 ink `<App>` 渲染 "hello"，验证 dev(`tsx`) 和 build 双轨都能跑 ink
5. 不动现有 readline 主循环——并行搭骨架

**E 阶段提交点**：ink 可跑通，现有 TUI 未动。

---

## 阶段 F — TUI 交互层用 ink 重写

把 readline + ResponseRenderer + TUI 类替换为 ink 组件树。

1. 组件化事件渲染：`<MessageStream>`(流式 token)、`<ToolList>`(工具调用)、`<Spinner>`、`<StatusLine>`、`<ApprovalModal>`
2. 输入层：`ink-text-input` + 自实现历史(复用 InputHistory 逻辑)、斜杠补全、粘贴检测
3. 事件循环：engine 事件 → React state（useState/useReducer），消除 cli.js 重复 3 次的 switch
4. 审批流：`rl.question` → `<ApprovalModal>` + Promise
5. **顺带拿到**：ink 自带 resize 响应；CJK 宽字符用 `string-width`(ink 依赖链已含)
6. 删除旧 renderer.js/tui/index.js/paste-utils 中被取代的部分
7. 跨终端手测：Windows Terminal / cmd / iTerm

**F 阶段提交点**：TUI 重构完成。

---

## 风险与回退

- **最大风险**：阶段 B（CJS→ESM）量大易错，尤其懒 require 改 async 的传染性、扩展名补全
- **缓解**：逐目录小步提交，每步 build+test 把关；脚本辅助扩展名补全
- **回退**：每阶段独立提交，任何阶段可 `git revert` 退回
- **基线**：当前 118 测试全绿 + tsc 0 错误，全程不得低于此基线
- **desktop 影响**：renderer 已 ESM 无碍；主进程 CJS 需验证能 import dist（阶段 D）
- **不可逆性**：用户已知晓并接受

## 工程量级（诚实预估）

- 阶段 A：小（半天）
- 阶段 B：**最大**（157 文件改模块语法 + 扩展名 + 懒 require，多个工作块）
- 阶段 C：大（重命名 + 类型补全）
- 阶段 D：中
- 阶段 E：小
- 阶段 F：**大**（交互层重写 ~1000 行 + 跨终端验证）

合计是改变项目工程性质的大工程。建议**按阶段分多次会话推进**，每阶段独立验收。

## 建议的起步

先做**阶段 A**（构建底座），它最小、可逆、立即可验证，且能让你直观看到"dev 用 tsx 启动"的真实体验，再决定是否继续往 B 推进。
