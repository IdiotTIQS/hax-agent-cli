export function flattenTree(nodes, bucket = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    bucket.push(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenTree(node.children, bucket);
    }
  }
  return bucket;
}

export function summarizeTree(nodes, depth = 0) {
  let files = 0;
  let directories = 0;
  let maxDepth = depth;

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    if (Array.isArray(node.children) && node.children.length > 0) {
      directories += 1;
      const nested = summarizeTree(node.children, depth + 1);
      files += nested.files;
      directories += nested.directories;
      maxDepth = Math.max(maxDepth, nested.depth);
    } else {
      files += 1;
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  return { files, directories, depth: maxDepth };
}

export function normalizePathForCompare(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function pathsMatch(left, right) {
  const normalizedLeft = normalizePathForCompare(left);
  const normalizedRight = normalizePathForCompare(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function pathBasename(value, fallback = '') {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || value || fallback;
}

export function normalizeWorkspaceSnapshot(snapshot = {}, fallbackPath = '') {
  const fileTree = Array.isArray(snapshot.fileTree) ? snapshot.fileTree : [];
  return {
    projectRoot: snapshot.projectRoot || fallbackPath || '',
    fileTree,
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : [],
    git: snapshot.git ? normalizeGitSnapshot(snapshot.git) : null,
    summary: summarizeTree(fileTree, 0),
  };
}

export function normalizeGitSnapshot(git = {}) {
  return {
    branch: git.branch || 'none',
    ahead: Number(git.ahead || 0),
    behind: Number(git.behind || 0),
    changed: Number(git.changed || 0),
    files: Array.isArray(git.files) ? git.files : [],
  };
}

export function shouldClearSelectedGitFile(selectedGitFile, gitFiles) {
  if (!selectedGitFile) return false;
  return !Array.isArray(gitFiles) || !gitFiles.some((file) => file.path === selectedGitFile);
}

export function createEmptyContentSearch() {
  return { query: '', matches: [], scannedFiles: 0, truncated: false };
}

export function normalizeContentSearchResult(result = {}, fallbackQuery = '') {
  return {
    query: result.query || fallbackQuery,
    matches: Array.isArray(result.matches) ? result.matches : [],
    scannedFiles: Number(result.scannedFiles || 0),
    truncated: Boolean(result.truncated),
  };
}
