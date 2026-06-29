interface FrontmatterValue {
  [key: string]: string | boolean;
}

interface ParsedFrontmatter {
  frontmatter: FrontmatterValue;
  body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const fm: FrontmatterValue = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      let v: string | boolean = line.slice(i + 1).trim();
      if (v === "true") v = true;
      else if (v === "false") v = false;
      fm[k] = v;
    }
  }
  return { frontmatter: fm, body: m[2].trim() };
}

export { parseFrontmatter };
