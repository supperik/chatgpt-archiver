export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/\son[a-z-]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son[a-z-]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s(href|src)\s*=\s*(['"])javascript:.*?\2/gi, " $1=\"#\"")
    .trim();
}

export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  return renderBlocks(normalized.split("\n")).join("\n");
}

function renderBlocks(lines: string[]): string[] {
  const blocks: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isFenceStart(trimmed)) {
      const rendered = renderCodeFence(lines, index);
      blocks.push(rendered.html);
      index = rendered.nextIndex;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const hashes = heading[1] ?? "#";
      const content = heading[2] ?? "";
      const level = hashes.length;
      blocks.push(`<h${level}>${renderInline(content)}</h${level}>`);
      index += 1;
      continue;
    }

    if (isHorizontalRule(trimmed)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (isTableHeader(lines, index)) {
      const rendered = renderTable(lines, index);
      blocks.push(rendered.html);
      index = rendered.nextIndex;
      continue;
    }

    if (isBlockquoteLine(trimmed)) {
      const rendered = renderBlockquote(lines, index);
      blocks.push(rendered.html);
      index = rendered.nextIndex;
      continue;
    }

    if (matchListMarker(line)) {
      const rendered = renderList(lines, index);
      blocks.push(rendered.html);
      index = rendered.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed) {
        index += 1;
        break;
      }
      if (
        isFenceStart(nextTrimmed)
        || isHorizontalRule(nextTrimmed)
        || isBlockquoteLine(nextTrimmed)
        || Boolean(matchListMarker(nextLine))
        || Boolean(/^(#{1,6})\s+/.exec(nextTrimmed))
        || isTableHeader(lines, index)
      ) {
        break;
      }

      paragraphLines.push(nextLine);
      index += 1;
    }

    blocks.push(`<p>${renderInline(paragraphLines.join("\n")).replace(/\n/g, "<br>")}</p>`);
  }

  return blocks;
}

function renderCodeFence(lines: string[], startIndex: number): { html: string; nextIndex: number } {
  const startLine = lines[startIndex] ?? "";
  const fenceMatch = /^\s*(```+|~~~+)\s*([\w-]+)?\s*$/.exec(startLine);
  const fence = fenceMatch?.[1] ?? "```";
  const language = fenceMatch?.[2]?.trim();
  const buffer: string[] = [];

  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (new RegExp(`^\\s*${escapeRegExp(fence)}\\s*$`).test(line)) {
      index += 1;
      break;
    }
    buffer.push(line);
    index += 1;
  }

  const languageAttr = language ? ` data-language="${escapeHtml(language)}"` : "";
  return {
    html: `<pre><code${languageAttr}>${escapeHtml(buffer.join("\n"))}</code></pre>`,
    nextIndex: index,
  };
}

function renderBlockquote(lines: string[], startIndex: number): { html: string; nextIndex: number } {
  const buffer: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      buffer.push("");
      index += 1;
      continue;
    }
    if (!isBlockquoteLine(line.trim())) {
      break;
    }
    buffer.push(line.replace(/^\s*>\s?/, ""));
    index += 1;
  }

  return {
    html: `<blockquote>${renderBlocks(buffer).join("\n")}</blockquote>`,
    nextIndex: index,
  };
}

function renderList(lines: string[], startIndex: number): { html: string; nextIndex: number } {
  const firstMarker = matchListMarker(lines[startIndex] ?? "");
  if (!firstMarker) {
    return {
      html: `<p>${renderInline(lines[startIndex] ?? "")}</p>`,
      nextIndex: startIndex + 1,
    };
  }

  const items: string[][] = [];
  let currentItem: string[] = [firstMarker.content];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      const nextLine = lines[index + 1] ?? "";
      if (matchListMarker(nextLine) && currentItem.length > 0) {
        items.push(currentItem);
        currentItem = [];
        index += 1;
        continue;
      }
      currentItem.push("");
      index += 1;
      continue;
    }

    const marker = matchListMarker(line);
    if (marker && marker.indent === firstMarker.indent && marker.ordered === firstMarker.ordered) {
      items.push(currentItem);
      currentItem = [marker.content];
      index += 1;
      continue;
    }

    if (marker && marker.indent <= firstMarker.indent) {
      break;
    }

    if (getIndentWidth(line) > firstMarker.indent) {
      currentItem.push(line.slice(Math.min(line.length, firstMarker.indent + 2)));
      index += 1;
      continue;
    }

    break;
  }

  if (currentItem.length > 0) {
    items.push(currentItem);
  }

  const tag = firstMarker.ordered ? "ol" : "ul";
  return {
    html: `<${tag}>${items.map((item) => `<li>${renderListItem(item)}</li>`).join("")}</${tag}>`,
    nextIndex: index,
  };
}

function renderListItem(lines: string[]): string {
  const content = renderBlocks(lines).join("\n");
  return unwrapSingleParagraph(content);
}

function renderTable(lines: string[], startIndex: number): { html: string; nextIndex: number } {
  const headerCells = splitTableRow(lines[startIndex] ?? "");
  const bodyRows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const row = lines[index] ?? "";
    if (!row.trim() || !row.includes("|")) {
      break;
    }
    bodyRows.push(splitTableRow(row));
    index += 1;
  }

  return {
    html: `
      <table>
        <thead>
          <tr>${headerCells.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${bodyRows
            .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
            .join("\n")}
        </tbody>
      </table>
    `.trim(),
    nextIndex: index,
  };
}

function renderInline(text: string): string {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    const key = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return key;
  };

  let output = text;
  output = output.replace(/`([^`]+)`/g, (_match, code: string) => stash(`<code>${escapeHtml(code)}</code>`));
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    return stash(`<a href="${escapeHtml(sanitizeUrl(href))}">${escapeHtml(label)}</a>`);
  });
  output = escapeHtml(output);
  output = output
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s([>])\*([^*\n]+)\*(?=[\s).,!?;:]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s([>])_([^_\n]+)_(?=[\s).,!?;:]|$)/g, "$1<em>$2</em>");

  return output.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] ?? "");
}

function sanitizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return "#";
}

function splitTableRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableHeader(lines: string[], index: number): boolean {
  const current = lines[index]?.trim();
  const next = lines[index + 1]?.trim();
  if (!current || !next || !current.includes("|") || !next.includes("|")) {
    return false;
  }

  const separators = splitTableRow(next);
  return separators.length > 0 && separators.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isFenceStart(line: string): boolean {
  return /^\s*(```+|~~~+)/.test(line);
}

function isHorizontalRule(line: string): boolean {
  return /^([-*_])(?:\s*\1){2,}$/.test(line);
}

function isBlockquoteLine(line: string): boolean {
  return /^\s*>/.test(line);
}

function matchListMarker(line: string): { ordered: boolean; indent: number; content: string } | null {
  const unordered = /^(\s*)[-*+]\s+(.+)$/.exec(line);
  if (unordered) {
    return {
      ordered: false,
      indent: (unordered[1] ?? "").length,
      content: unordered[2] ?? "",
    };
  }

  const ordered = /^(\s*)\d+\.\s+(.+)$/.exec(line);
  if (ordered) {
    return {
      ordered: true,
      indent: (ordered[1] ?? "").length,
      content: ordered[2] ?? "",
    };
  }

  return null;
}

function getIndentWidth(line: string): number {
  const match = /^(\s*)/.exec(line);
  return (match?.[1] ?? "").length;
}

function unwrapSingleParagraph(html: string): string {
  const trimmed = html.trim();
  if (trimmed.startsWith("<p>") && trimmed.endsWith("</p>") && trimmed.indexOf("</p>\n<p>") === -1) {
    return trimmed.slice(3, -4);
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
