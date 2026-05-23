# Memory System

HaxAgent's memory system persists key-value records to disk, with **namespace** and **tag** support for organizing knowledge across projects and contexts.

---

## Storage Location and Format

Memories are stored as individual JSON files in the configured `memoryDirectory` (defaults to a `.haxagent/memories/` directory under the project root).

**File naming:** each memory name is slugified and appended with an 8-character hash of the original name to avoid collisions. The file extension is `.json`.

**Record shape on disk:**

```json
{
  "name": "api-design",
  "namespace": "my-service",
  "tags": ["architecture", "decision"],
  "createdAt": "2026-05-22T10:00:00.000Z",
  "updatedAt": "2026-05-22T12:30:00.000Z",
  "content": "We decided to use REST for the public API..."
}
```

---

## CLI Commands

### `/memory write`

Create or update a memory. On update the existing `namespace`, `tags`, and `createdAt` are preserved; only `content` and `updatedAt` change.

```
/memory write [--namespace <ns>] [--tag <tag>] <name> <content>
```

**Examples:**

```bash
# Basic write
/memory write api-design We decided to use REST for the public API and GraphQL for internal services.

# With namespace
/memory write --namespace my-project architecture-decisions We use a microservices pattern with event-driven communication.

# With namespace and tag
/memory write --namespace my-project --tag decision db-choice We chose PostgreSQL for primary storage and Redis for caching.

# Update an existing memory (same name)
/memory write --namespace my-project architecture-decisions UPDATED: We now use a modular monolith approach instead of microservices.
```

**Note:** Currently only one `--tag` flag is supported per CLI call. For multiple tags, use the programmatic API.

---

### `/memory read`

Read a single memory by name.

```
/memory read <name>
```

**Examples:**

```bash
/memory read api-design
/memory read architecture-decisions
```

Output includes the memory's namespace, tags, and full content.

---

### `/memory list`

List all stored memories. Supports optional `--namespace` and `--tag` filters.

```
/memory list [--namespace <ns>] [--tag <tag>]
```

**Examples:**

```bash
# List all memories
/memory list

# List only memories in the "my-project" namespace
/memory list --namespace my-project

# List memories in "my-project" tagged "decision"
/memory list --namespace my-project --tag decision
```

Output columns: **name**, **@namespace**, **#tags**, and **last-updated date**.

---

### `/memory search`

Full-text search with weighted relevance scoring. Returns results sorted by score (highest first).

```
/memory search [--namespace <ns>] [--tag <tag>] <keyword>
```

**Scoring weights:**

| Match location | Points |
|---|---|
| Match in name | +30 |
| Word-boundary match in name | +20 |
| Match in a tag | +25 |
| Match in namespace | +20 |
| Match in content | +10 |
| Word-boundary match in content | +10 |

**Examples:**

```bash
# Search across all namespaces
/memory search PostgreSQL

# Search within a specific namespace
/memory search --namespace my-project database

# Search within a namespace, filtered by tag
/memory search --namespace my-project --tag decision architecture
```

Results show **name**, **namespace**, **tags**, **relevance score** in parentheses, and a content preview (first 80 characters). Use `/memory read <name>` to see full content.

---

### `/memory delete`

Remove a memory permanently.

```
/memory delete <name>
```

**Example:**

```bash
/memory delete old-notes
/memory delete api-design
```

---

## Namespace Best Practices

Namespaces partition memories into logical groups. They prevent name collisions and simplify filtering.

**Recommended patterns:**

- **Per-project:** `--namespace my-frontend`, `--namespace billing-service`
- **Per-team:** `--namespace team-platform`, `--namespace team-mobile`
- **Per-context:** `--namespace adr` (architecture decision records), `--namespace oncall` (incident notes), `--namespace onboarding` (new-hire guides)
- **Per-environment:** `--namespace production`, `--namespace staging`

**Rules of thumb:**

1. Use `default` for general-purpose memories that don't belong to a specific project.
2. Keep namespace names short, lowercase, and hyphenated.
3. A memory's namespace is set at first write and **preserved on updates** -- choose carefully on creation.
4. Avoid nesting or hierarchy -- namespaces are flat. Use naming conventions instead (e.g., `team-platform` and `team-mobile` rather than `team/platform`).

---

## Tag Best Practices

Tags add lightweight, cross-cutting metadata to memories. A single memory can have multiple tags (via the programmatic API).

**Recommended patterns:**

- **Categorize by type:** `#decision`, `#todo`, `#reference`, `#incident`, `#meeting-notes`
- **Indicate status:** `#draft`, `#final`, `#deprecated`, `#in-progress`
- **Group by domain:** `#architecture`, `#security`, `#performance`, `#api`, `#database`
- **Flag for action:** `#review-needed`, `#blocked`, `#priority`

**Rules of thumb:**

1. Tags are case-insensitive for filtering and search.
2. Use tags sparingly -- 2 to 5 tags per memory is a good range.
3. Standardize on a small vocabulary across your team to keep search results predictable.
4. Combine tags with namespaces for precise filtering: `/memory list --namespace my-project --tag decision` shows only architecture decisions for that project.

---

## Programmatic API

Import the memory module directly:

```js
const {
  writeMemory,
  readMemory,
  listMemories,
  deleteMemory,
  searchMemories,
} = require('./src/memory');
```

All functions accept an `options` object that derives storage paths from `settings.projectRoot` and `settings.memoryDirectory`.

---

### `writeMemory(name, content, options)`

Creates or updates a memory.

```js
// Simple write
writeMemory('api-design', 'We decided to use REST for the public API.');

// With namespace and multiple tags
writeMemory('architecture-decisions', 'Microservices with event-driven communication.', {
  namespace: 'my-project',
  tags: ['architecture', 'decision']
});

// Update (namespace and tags are preserved from the existing record)
writeMemory('architecture-decisions', 'Now using modular monolith instead of microservices.', {
  namespace: 'my-project'
});
// -> { name, namespace: 'my-project', tags: ['architecture', 'decision'],
//      createdAt: <original>, updatedAt: <now>, content: <new> }
```

---

### `readMemory(name, options)`

Returns the full record object, or `null` if not found.

```js
const mem = readMemory('api-design');
if (mem) {
  console.log(mem.name);       // "api-design"
  console.log(mem.namespace);  // "default"
  console.log(mem.tags);       // []
  console.log(mem.content);    // "We decided to use REST..."
  console.log(mem.createdAt);  // ISO timestamp
  console.log(mem.updatedAt);  // ISO timestamp
}
```

---

### `listMemories(options)`

Returns an array of all memory records, sorted by `updatedAt` descending.

```js
const all = listMemories();
console.log(`Total memories: ${all.length}`);

// Filter by namespace in application code
const projectMems = all.filter(m => m.namespace === 'my-project');
console.log(`Project memories: ${projectMems.length}`);

// Filter by tag
const todos = all.filter(m => (m.tags || []).includes('todo'));
console.log(`TODOs: ${todos.length}`);
```

---

### `searchMemories(query, options)`

Returns scored results sorted by relevance. Accepts optional `namespace` and `tag` filters.

```js
// Broad search
const results = searchMemories('PostgreSQL');
results.forEach(r => console.log(`${r.name} (score: ${r.score})`));

// Scoped search
const decisions = searchMemories('architecture', {
  namespace: 'my-project',
  tag: 'decision'
});
console.log(`${decisions.length} architecture decisions found.`);

// Iterate results
for (const mem of decisions) {
  console.log(`[${mem.score}] ${mem.name}`);
  console.log(`  ${mem.content.slice(0, 100)}...`);
  console.log(`  @${mem.namespace} #${(mem.tags || []).join(' #')}`);
}
```

---

### `deleteMemory(name, options)`

Removes a memory. Returns `true` if deleted, `false` if it didn't exist.

```js
if (deleteMemory('obsolete-notes')) {
  console.log('Deleted successfully.');
} else {
  console.log('Memory not found.');
}
```

---

## Full Example: Programmatic Workflow

```js
const {
  writeMemory,
  readMemory,
  listMemories,
  deleteMemory,
  searchMemories,
} = require('./src/memory');

const projectNs = { namespace: 'my-service' };

// Seed some memories
writeMemory('onboarding', 'Steps to set up the dev environment...', {
  ...projectNs,
  tags: ['reference', 'onboarding']
});
writeMemory('db-schema', 'Users table schema and migration strategy...', {
  ...projectNs,
  tags: ['database', 'architecture']
});
writeMemory('deploy-checklist', 'Pre-deploy steps: run tests, check migrations, notify #eng...', {
  ...projectNs,
  tags: ['todo', 'deploy']
});

// List all memories for this project
console.log('\n--- All memories for my-service ---');
listMemories()
  .filter(m => m.namespace === 'my-service')
  .forEach(m => console.log(`  ${m.name} [${(m.tags || []).join(', ')}]`));

// Search for deployment-related info
console.log('\n--- Search: "deploy" ---');
searchMemories('deploy', { namespace: 'my-service' })
  .forEach(r => console.log(`  ${r.name} (score: ${r.score})`));

// Read a specific memory
const checklist = readMemory('deploy-checklist', projectNs);
console.log(`\n--- ${checklist.name} ---`);
console.log(checklist.content);

// Delete when no longer needed
deleteMemory('onboarding', projectNs);
console.log('\nRemaining:', listMemories()
  .filter(m => m.namespace === 'my-service')
  .map(m => m.name)
  .join(', '));
```
