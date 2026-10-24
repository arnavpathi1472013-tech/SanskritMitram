// markdown.js - a small, dependency-free Markdown renderer.
//
// It works in two steps:
//   1. parseMarkdown(text)  -> a list of plain JavaScript "blocks" (no DOM involved)
//   2. renderBlocks(blocks) -> real DOM elements
//
// SECURITY: the output is built only with document.createElement and
// textContent. Nothing is ever inserted with innerHTML, so raw HTML written in
// a Markdown file is shown as text, never executed. Link and image addresses
// are checked before use (javascript: and similar addresses are dropped).
//
// Supported: headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`,
// fenced code blocks, block quotes, bullet/numbered lists (nested), tables,
// horizontal rules, links and images, and ```quiz-json blocks (handed to the
// quiz renderer supplied by the page). A single line break inside a paragraph
// is kept as a line break (handy for shlokas).
//
// Lines such as "#title: ..." and "#keywords: ..." are catalogue metadata and
// are removed before rendering.

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>[ \t]?(.*)$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const DIRECTIVE = /^ {0,3}#(title|keywords)[ \t]*:/i;
const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>";
const QUIZ_LANGUAGE = "quiz-json"; // must match QUIZ_LANGUAGE in quiz-core.js

// ---------------------------------------------------------------------------
// Step 1: text -> blocks
// ---------------------------------------------------------------------------

export function parseMarkdown(text) {
  const normalized = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
  return parseBlocks(stripDirectives(lines));
}

function stripDirectives(lines) {
  const kept = [];
  let fence = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (f) {
      const marker = f[1];
      if (fence === null) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && !f[2].trim()) fence = null;
    } else if (fence === null && DIRECTIVE.test(line)) {
      continue;
    }
    kept.push(line);
  }
  return kept;
}

const isBlank = (line) => line.trim() === "";
const leadingSpaces = (line) => line.length - line.trimStart().length;

function startsNewBlock(lines, i) {
  const line = lines[i];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(lines, i)
  );
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    let m = FENCE.exec(line);
    if (m) {
      const char = m[1][0];
      const length = m[1].length;
      const closing = new RegExp("^ {0,3}\\" + char + "{" + length + ",}\\s*$");
      const code = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
      i++; // skip the closing fence (or run off the end if it is missing)
      // A fence labelled "quiz-json" holds quiz data, not ordinary code.
      const language = m[2].trim().split(/\s+/)[0].toLowerCase();
      blocks.push({ type: language === QUIZ_LANGUAGE ? "quiz" : "code", text: code.join("\n") });
      continue;
    }

    m = HEADING.exec(line);
    if (m) {
      blocks.push({ type: "heading", level: m[1].length, children: parseInline(m[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && BLOCKQUOTE.test(lines[i])) inner.push(BLOCKQUOTE.exec(lines[i++])[1]);
      blocks.push({ type: "quote", blocks: parseBlocks(inner) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const result = parseList(lines, i);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const result = parseTable(lines, i);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    // Paragraph: keep reading until a blank line or the start of another block.
    const paragraph = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsNewBlock(lines, i)) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

function parseList(lines, start) {
  const first = LIST_ITEM.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list = {
    type: "list",
    ordered,
    start: ordered ? parseInt(first[2], 10) : 1,
    tight: true,
    items: [],
  };

  const isSibling = (line) => {
    const m = LIST_ITEM.exec(line);
    return !!m && m[1].length >= baseIndent && m[1].length < baseIndent + 2 && /\d/.test(m[2]) === ordered;
  };

  let i = start;
  while (i < lines.length && isSibling(lines[i])) {
    const itemLines = [LIST_ITEM.exec(lines[i])[3]];
    i++;

    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && leadingSpaces(lines[j]) >= baseIndent + 2) {
          // A blank line inside the item, followed by more indented content.
          for (let k = i; k < j; k++) itemLines.push("");
          list.tight = false;
          i = j;
          continue;
        }
        break;
      }
      const indent = leadingSpaces(line);
      if (indent >= baseIndent + 2) {
        itemLines.push(line.slice(Math.min(indent, baseIndent + 2)));
        i++;
        continue;
      }
      break;
    }

    list.items.push({ blocks: parseBlocks(itemLines) });

    // A blank line between two items makes the list "loose" (paragraph spacing).
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    if (j > i) {
      if (j < lines.length && isSibling(lines[j])) {
        list.tight = false;
        i = j;
      } else {
        break;
      }
    }
  }
  return { block: list, next: i };
}

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (text[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += text[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableStart(lines, i) {
  const header = lines[i];
  const separator = lines[i + 1];
  return (
    separator !== undefined &&
    header.includes("|") &&
    separator.includes("|") &&
    TABLE_SEPARATOR.test(separator) &&
    splitRow(header).length === splitRow(separator).length
  );
}

function parseTable(lines, start) {
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const rows = [];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
    const cells = splitRow(lines[i]);
    while (cells.length < header.length) cells.push("");
    rows.push(cells.slice(0, header.length).map((cell) => parseInline(cell)));
    i++;
  }
  return {
    block: { type: "table", aligns, header: header.map((cell) => parseInline(cell)), rows },
    next: i,
  };
}

// ---------------------------------------------------------------------------
// Inline parsing: **bold**, *italic*, `code`, [links](...), ![images](...)
// ---------------------------------------------------------------------------

export function parseInline(text) {
  const out = [];
  let buffer = "";
  let i = 0;
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "\n") {
        flush();
        out.push({ type: "br" });
        i += 2;
        continue;
      }
      if (ESCAPABLE.includes(next)) {
        buffer += next;
        i += 2;
        continue;
      }
    }

    if (ch === "\n") {
      flush();
      out.push({ type: "br" });
      i++;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let end = text.indexOf(fence, i + run);
      while (end !== -1 && (text[end - 1] === "`" || text[end + run] === "`")) {
        end = text.indexOf(fence, end + 1);
      }
      if (end !== -1) {
        flush();
        out.push({ type: "code", value: text.slice(i + run, end).replace(/\n/g, " ").trim() });
        i = end + run;
        continue;
      }
    }

    if (ch === "[" || (ch === "!" && text[i + 1] === "[")) {
      const isImage = ch === "!";
      const open = isImage ? i + 1 : i;
      const close = findClosingBracket(text, open);
      if (close !== -1 && text[close + 1] === "(") {
        const destination = parseDestination(text, close + 2);
        if (destination) {
          flush();
          const label = text.slice(open + 1, close);
          if (isImage) out.push({ type: "image", alt: inlineToText(parseInline(label)), url: destination.url });
          else out.push({ type: "link", url: destination.url, children: parseInline(label) });
          i = destination.end;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const match = matchDelimited(text, i);
      if (match) {
        flush();
        out.push({ type: match.type, children: parseInline(match.inner) });
        i = match.end;
        continue;
      }
    }

    buffer += ch;
    i++;
  }
  flush();
  return out;
}

function findClosingBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

// Reads the "(address "optional title")" part of a link. Returns {url, end} or null.
function parseDestination(text, from) {
  let i = from;
  while (text[i] === " ") i++;
  let url;
  if (text[i] === "<") {
    const close = text.indexOf(">", i + 1);
    if (close === -1) return null;
    url = text.slice(i + 1, close);
    i = close + 1;
  } else {
    const begin = i;
    let depth = 0;
    while (i < text.length && text[i] !== " " && text[i] !== "\n") {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    url = text.slice(begin, i);
  }
  while (text[i] === " ") i++;
  if (text[i] === '"' || text[i] === "'") {
    const close = text.indexOf(text[i], i + 1);
    if (close === -1) return null;
    i = close + 1;
    while (text[i] === " ") i++;
  }
  return text[i] === ")" ? { url, end: i + 1 } : null;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function matchDelimited(text, i) {
  const ch = text[i];
  let run = 1;
  while (text[i + run] === ch) run++;

  let marker;
  let type;
  if (ch === "~") {
    if (run < 2) return null;
    marker = "~~";
    type = "del";
  } else if (run >= 2) {
    marker = ch + ch;
    type = "strong";
  } else {
    marker = ch;
    type = "em";
  }

  const innerStart = i + marker.length;
  if (innerStart >= text.length || /\s/.test(text[innerStart])) return null;
  if (ch === "_" && i > 0 && WORD_CHAR.test(text[i - 1])) return null; // snake_case_words

  let j = innerStart;
  while (j < text.length) {
    j = text.indexOf(marker, j);
    if (j === -1) return null;
    const before = text[j - 1];
    const after = text[j + marker.length];
    const usable =
      j > innerStart &&
      !/\s/.test(before) &&
      before !== "\\" &&
      !(marker.length === 1 && (before === ch || after === ch)) &&
      !(ch === "_" && after !== undefined && WORD_CHAR.test(after));
    if (usable) return { type, inner: text.slice(innerStart, j), end: j + marker.length };
    j += marker.length;
  }
  return null;
}

// Plain-text version of inline nodes (used for image alt text and heading comparison).
export function inlineToText(nodes) {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.value;
      if (node.type === "br") return " ";
      if (node.type === "image") return node.alt;
      return node.children ? inlineToText(node.children) : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Step 2: blocks -> DOM
// ---------------------------------------------------------------------------
//
// options:
//   baseUrl       absolute address of the Markdown file; relative links and
//                 images are resolved against it
//   linkResolver  optional function(URL) -> string|null; lets the page turn a
//                 link to another lesson into an in-site link
//   headingOffset added to heading levels (the page already has its own h1/h2)
//   renderQuiz    optional function(jsonText) -> element; draws a ```quiz-json block

export function renderBlocks(blocks, options = {}) {
  const fragment = document.createDocumentFragment();
  for (const block of blocks) fragment.append(renderBlock(block, options));
  return fragment;
}

function renderBlock(block, options) {
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level + (options.headingOffset || 0)));
      const heading = document.createElement("h" + level);
      heading.append(renderInline(block.children, options));
      return heading;
    }
    case "paragraph": {
      const p = document.createElement("p");
      p.append(renderInline(block.children, options));
      return p;
    }
    case "code":
      return renderCodeBlock(block.text);
    case "quiz":
      // The page supplies options.renderQuiz. Without it (for example when
      // markdown.js is used alone) the block is shown as ordinary code.
      return options.renderQuiz ? options.renderQuiz(block.text) : renderCodeBlock(block.text);
    case "hr":
      return document.createElement("hr");
    case "quote": {
      const quote = document.createElement("blockquote");
      quote.append(renderBlocks(block.blocks, options));
      return quote;
    }
    case "list":
      return renderList(block, options);
    case "table":
      return renderTable(block, options);
    default:
      return document.createDocumentFragment();
  }
}

function renderCodeBlock(text) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = text;
  pre.append(code);
  return pre;
}

function renderList(block, options) {
  const list = document.createElement(block.ordered ? "ol" : "ul");
  if (block.ordered && block.start !== 1) list.start = block.start;
  for (const item of block.items) {
    const li = document.createElement("li");
    for (const child of item.blocks) {
      if (block.tight && child.type === "paragraph") li.append(renderInline(child.children, options));
      else li.append(renderBlock(child, options));
    }
    list.append(li);
  }
  return list;
}

function renderTable(block, options) {
  const wrapper = document.createElement("div"); // lets wide tables scroll sideways on phones
  wrapper.className = "table-scroll";
  const table = document.createElement("table");

  const addRow = (parent, cells, tag) => {
    const tr = document.createElement("tr");
    cells.forEach((cell, index) => {
      const td = document.createElement(tag);
      if (block.aligns[index]) td.style.textAlign = block.aligns[index];
      td.append(renderInline(cell, options));
      tr.append(td);
    });
    parent.append(tr);
  };

  const thead = document.createElement("thead");
  addRow(thead, block.header, "th");
  const tbody = document.createElement("tbody");
  for (const row of block.rows) addRow(tbody, row, "td");
  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}

function renderInline(nodes, options) {
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        fragment.append(document.createTextNode(node.value));
        break;
      case "br":
        fragment.append(document.createElement("br"));
        break;
      case "code": {
        const code = document.createElement("code");
        code.textContent = node.value;
        fragment.append(code);
        break;
      }
      case "strong":
      case "em":
      case "del": {
        const el = document.createElement(node.type);
        el.append(renderInline(node.children, options));
        fragment.append(el);
        break;
      }
      case "link":
        fragment.append(renderLink(node, options));
        break;
      case "image":
        fragment.append(renderImage(node, options));
        break;
    }
  }
  return fragment;
}

function safeUrl(raw, baseUrl, allowedProtocols) {
  const value = raw.trim();
  if (!value || value.startsWith("#")) return null;
  try {
    const url = new URL(value, baseUrl);
    return allowedProtocols.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function renderLink(node, options) {
  const url = safeUrl(node.url, options.baseUrl, ["http:", "https:", "mailto:"]);
  if (!url) {
    // Unsafe or unsupported address: show the text without making it a link.
    const span = document.createElement("span");
    span.append(renderInline(node.children, options));
    return span;
  }
  const a = document.createElement("a");
  const internal = options.linkResolver ? options.linkResolver(url) : null;
  if (internal) {
    a.href = internal;
  } else {
    a.href = url.href;
    const opensElsewhere =
      (url.protocol !== "mailto:" && url.origin !== window.location.origin) || /\.pdf$/i.test(url.pathname);
    if (opensElsewhere) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  a.append(renderInline(node.children, options));
  return a;
}

function renderImage(node, options) {
  const url = safeUrl(node.url, options.baseUrl, ["http:", "https:"]);
  if (!url) return document.createTextNode(node.alt ? "[" + node.alt + "]" : "");
  const img = document.createElement("img");
  img.src = url.href;
  img.alt = node.alt;
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}
