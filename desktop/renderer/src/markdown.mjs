import MarkdownIt from 'markdown-it';
import createDOMPurify from 'dompurify';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
  validateLink(url) {
    try {
      const parsed = new URL(url);
      return ALLOWED_PROTOCOLS.has(parsed.protocol);
    } catch {
      return false;
    }
  },
});

const defaultLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';

  token.attrJoin('class', 'markdown-link');
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noreferrer noopener');
  if (!isSafeUrl(href)) {
    token.attrSet('href', '#');
  }

  return defaultLinkOpen
    ? defaultLinkOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

markdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = normalizeLanguage(token.info);
  const code = token.content || '';

  return [
    '<div class="code-block-wrap">',
    '<div class="code-block-header">',
    `<span class="code-block-lang">${escapeHtml(lang || 'code')}</span>`,
    `<button class="code-block-btn" type="button" data-copy="${escapeAttr(code)}">复制</button>`,
    '</div>',
    '<div class="code-block-body">',
    `<pre><code>${escapeHtml(code)}</code></pre>`,
    '</div>',
    '</div>',
  ].join('');
};

export function renderMarkdown(content) {
  const source = stripUnsafeMarkdownLinks(stripToolCalls(String(content || '')));
  if (!source.trim()) return '';

  return sanitize(markdown.render(source));
}

function stripUnsafeMarkdownLinks(text) {
  return String(text || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    return isSafeUrl(href) ? match : label;
  });
}

export function stripToolCalls(text) {
  return String(text || '')
    .replace(/<\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls\b[^>]*>[\s\S]*?<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>/g, '')
    .replace(/<([A-Za-z][\w.-]*)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitize(html) {
  const purifier = createPurifier();

  return purifier.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'button', 'code', 'div', 'em', 'h1', 'h2', 'h3',
      'hr', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'ul',
    ],
    ALLOWED_ATTR: ['class', 'data-copy', 'href', 'rel', 'target', 'type'],
    ALLOW_DATA_ATTR: false,
  });
}

function createPurifier() {
  if (typeof createDOMPurify === 'function' && globalThis.window) {
    return createDOMPurify(globalThis.window);
  }

  if (createDOMPurify?.sanitize) {
    return createDOMPurify;
  }

  throw new Error('DOMPurify requires a browser or jsdom window.');
}

function normalizeLanguage(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)[0]
    .replace(/[^\w#+.-]/g, '')
    .slice(0, 32);
}

function isSafeUrl(value) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
