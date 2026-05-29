# OpenHarness 代码迁移实施计划 (Phase 2)

**日期:** 2026-05-29
**目标:** 从 OpenHarness 迁移 6 个高价值模块到 HaxAgent
**执行模式:** Subagent-driven (TDD)

---

## 模块清单

| # | 模块 | 源文件 | 目标文件 | 价值 | 工作量 |
|---|------|--------|----------|------|--------|
| 1 | LSP 代码导航 | `services/lsp/__init__.py` (7KB) | `src/services/lsp.js` | HIGH | LOW |
| 2 | 对话压缩重写 | `services/compact/__init__.py` (67KB) | `src/services/compact/index.js` | HIGH | HIGH |
| 3 | 环境个性化 | `personalization/` (8KB) | `src/services/personalization.js` | MED | LOW |
| 4 | 会话记忆 | `services/session_memory/` (5KB) | `src/services/session-memory.js` | MED | LOW |
| 5 | 记忆提取 | `services/memory_extract/` (10KB) | `src/services/memory-extract.js` | MED | MED |
| 6 | 自动记忆整合 | `services/autodream/` (25KB) | `src/services/autodream/index.js` | MED | MED |

---

## Task 1: LSP 代码导航 ✅ (LOW)

**Source:** `E:\HaxAgent\.audit\OpenHarness\src\openharness\services\lsp\__init__.py`
**Target:** `E:\HaxAgent\src\services\lsp.js`

### What to implement:
- LSP (Lightweight Symbol Parser) for JavaScript/TypeScript/Python
- AST-based code intelligence: definition, references, hover, symbol search
- File extension detection → language selection
- No external dependencies (pure AST regex + tree walk)

### Key functions to port from Python:
```python
- _get_definitions(code, language) → [{name, line, col, kind}]
- _get_references(code, symbol_name, language) → [{line, col}]
- _get_symbols(code, language) → [{name, kind, line, col}]
- _get_hover_info(code, line, col, language) → {type, doc}
- detect_language(file_path) → "javascript"|"typescript"|"python"|"text"
- parse_code(code, language) → SyntaxTree
```

### Verify:
- Test with sample JS/TS/Python code
- Definition/reference extraction accuracy > 90%
- Runs in < 100ms for 1000-line files

---

## Task 2: 对话压缩重写 🔴 (HIGH)

**Source:** `E:\HaxAgent\.audit\OpenHarness\src\openharness\services\compact\__init__.py`
**Target:** `E:\HaxAgent\src\services\compact\index.js`

### What to implement:
1. **Token estimation** — character-based heuristic with CJK awareness
2. **Micro-compact** — clear old tool results, keep conversation context
3. **Full compact** — LLM-based summarization of older messages
4. **Compact state management** — tracking compaction rounds, thresholds
5. **Session memory continuity** — preserve key facts across compaction boundaries
6. **Automatic compaction triggers** — before API calls when threshold exceeded
7. **Reactive compaction** — when API returns "context length exceeded"

### Key types to port:
```python
- CompactState: rounds, last_compact_at, auto_compact_threshold, micro_compact_at
- MicroCompactResult: messages, removed_count, token_savings
- FullCompactResult: messages, summary, token_savings
- CompactContext: session_memory, recent_files, active_goal
```

### Architecture:
```
compact(messages, options) → {messages, stats}
  ├── estimateTokens(messages) → number
  ├── microCompact(messages) → messages (clear old tool results)
  ├── fullCompact(messages, llm) → messages (LLM summarization)
  └── maybeAutoCompact(session) → void (triggered before API call)
```

### Verify:
- Micro-compact reduces tokens by 30-50% without losing context
- Full compact preserves key facts across summarization
- No information loss for the most recent 6 messages
- Handles 10k+ message conversations

---

## Task 3: 环境个性化 🟢 (LOW)

**Source:** `E:\HaxAgent\.audit\OpenHarness\src\openharness\personalization/`
**Target:** `E:\HaxAgent\src\services\personalization.js`

### What to implement:
- Regex-based extraction of environment facts from conversation history
- Fact categories: SSH hosts, IPs, data paths, conda environments, API endpoints, git remotes, cron schedules, Ray clusters
- Deduplication by fact signature
- Rules generation for inclusion in system prompt
- Session hook for automatic extraction after each turn

### Key patterns:
```javascript
- extractSshHosts(text) → [{host, user, port}]
- extractDataPaths(text) → [{path, type: "file"|"dir"}]
- extractApiEndpoints(text) → [{url, method}]
- extractGitRemotes(text) → [{name, url}]
- generateEnvironmentRules(facts) → string (for system prompt)
```

### Verify:
- Correctly extracts SSH hosts from terminal output
- Correctly parses data paths from file.glob results
- Generates valid system prompt rules

---

## Task 4: 会话记忆 🟢 (LOW)

**Source:** `E:\HaxAgent\.audit\OpenHarness\src\openharness\services\session_memory\__init__.py`
**Target:** `E:\HaxAgent\src\services\session-memory.js`

### What to implement:
- File-backed session memory snapshots
- JSON serialization of session state (messages, tool calls, stats)
- Memory file naming: `{session_id}_{timestamp}.json`
- Auto-save on compaction events
- Memory loading for session resume
- Size limits and rotation

### Key functions:
```javascript
- saveSessionSnapshot(session, memoryDir) → path
- loadSessionSnapshot(path) → sessionData
- listSnapshots(sessionId, memoryDir) → [{path, timestamp, tokenCount}]
- pruneOldSnapshots(memoryDir, maxSnapshots=10)
```

### Verify:
- Snapshots can be saved and loaded without data loss
- Old snapshots are auto-pruned
- Compatible with existing Session class

---

## Task 5: 记忆提取 🟡 (MEDIUM)

**Source:** `E:\HaxAgent\.audit\OpenHarness\src\openharness\services\memory_extract\__init__.py`
**Target:** `E:\HaxAgent\src\services\memory-extract.js`

### What to implement:
- LLM-based memory extraction prompt template
- Extract durable memories from user messages + assistant responses
- Integration with DurableMemoryStore (from previous work)
- Categories: user_preference, project_fact, technique, convention, error_solution
- Confidence scoring for extracted memories
- Rate limiting (max extractions per session)

### Key functions:
```javascript
- buildExtractionPrompt(messages, existingMemories) → string
- extractMemories(llmResponse) → [{content, category, confidence}]
- shouldExtract(turnCount, lastExtractionTime) → boolean
- mergeWithExisting(newMemories, existingMemories) → memories
```

### Verify:
- Correctly extracts user preferences from "I prefer..." statements
- Correctly extracts project facts from file operations
- Deduplicates against existing memories
- Rate limits to prevent excessive LLM calls

---

## Task 6: 自动记忆整合 🟡 (MEDIUM)

**Source:** `E:\HaxAgent\.audit\OpenHarness\src\openharness\services\autodream/`
**Target:** `E:\HaxAgent\src\services\autodream/index.js`

### What to implement:
- Spawns background memory consolidation process
- Analyzes recent session history for stale/duplicate memories
- LLM-based consolidation prompt
- Backup before consolidation (rollback capability)
- File locking for concurrent access safety
- Schedule: triggered after N turns or M minutes

### Key functions:
```javascript
- scheduleConsolidation(session, options) → timer
- consolidateMemories(memoryDir, llm) → {consolidated, removed, backupPath}
- shouldConsolidate(memoryDir) → boolean
- createBackup(memoryDir) → backupPath
- rollback(backupPath) → void
```

### Verify:
- Consolidation runs without blocking main agent loop
- Backup created before any mutation
- Duplicate memories are merged correctly
- Stale memories are archived

---

## Subagent 执行计划

按 Superpowers 流程，每个 Task 派发一个 implementer subagent:

```
Task 1 (LSP)     → subagent: implementer-lsp
Task 2 (Compact)  → subagent: implementer-compact  
Task 3 (Personal) → subagent: implementer-personal
Task 4 (Session)  → subagent: implementer-session
Task 5 (Memory)   → subagent: implementer-memory
Task 6 (Autodream)→ subagent: implementer-autodream
```

每个 subagent 执行: TDD (写测试 → 看失败 → 实现 → 看通过) → 宣布完成

执行顺序: Tasks 1,3,4 并行 (LOW effort) → 完成后 → Tasks 5,6 并行 (MEDIUM) → 最后 Task 2 (HIGH)
