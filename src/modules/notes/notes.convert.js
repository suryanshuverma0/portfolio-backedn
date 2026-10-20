import { getStroke } from "perfect-freehand";

// ---------------------------------------------------------------------------
// Converters for note content:
//   • Tiptap/ProseMirror JSON → GitHub-flavoured Markdown (blog publishing)
//   • Tiptap JSON → HTML (readable Google Docs backup)
//   • ink stroke → SVG path (PDF export / previews), matching the editor's
//     perfect-freehand settings so exports look like what was written.
// ---------------------------------------------------------------------------

/* ============================ Markdown ============================ */

const escapeMd = (text) => text.replace(/([\\`*_[\]<>|])/g, "\\$1");

const inlineMd = (nodes = []) =>
  nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "image") return `![${node.attrs?.alt || ""}](${node.attrs?.src})`;
      if (node.type !== "text") return "";

      const marks = node.marks || [];
      const isCode = marks.some((m) => m.type === "code");
      let text = isCode ? `\`${node.text.replace(/`/g, "\\`")}\`` : escapeMd(node.text);

      if (!isCode) {
        if (marks.some((m) => m.type === "bold")) text = `**${text}**`;
        if (marks.some((m) => m.type === "italic")) text = `_${text}_`;
        if (marks.some((m) => m.type === "strike")) text = `~~${text}~~`;
        // Markdown has no highlight/underline; bold keeps the emphasis.
        if (marks.some((m) => m.type === "highlight") && !marks.some((m) => m.type === "bold")) text = `**${text}**`;
      }
      const link = marks.find((m) => m.type === "link");
      if (link?.attrs?.href) text = `[${text}](${link.attrs.href})`;
      return text;
    })
    .join("");

const indent = (text, prefix) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 || !line ? line : prefix + line))
    .join("\n");

const blockMd = (node, depth = 0) => {
  const children = node.content || [];
  switch (node.type) {
    case "doc":
      return children.map((n) => blockMd(n, depth)).filter(Boolean).join("\n\n");
    case "paragraph":
      return inlineMd(children);
    case "heading":
      return `${"#".repeat(Math.min(6, node.attrs?.level || 1))} ${inlineMd(children)}`;
    case "blockquote":
      return children
        .map((n) => blockMd(n, depth))
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\`\`\`${node.attrs?.language || ""}\n${children.map((c) => c.text || "").join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "image":
      return `![${node.attrs?.alt || ""}](${node.attrs?.src})`;
    case "bulletList":
    case "orderedList":
    case "taskList":
      return children
        .map((item, i) => {
          const marker =
            node.type === "orderedList"
              ? `${(node.attrs?.start || 1) + i}.`
              : node.type === "taskList"
                ? `- [${item.attrs?.checked ? "x" : " "}]`
                : "-";
          const body = (item.content || []).map((n) => blockMd(n, depth + 1)).join("\n");
          return `${marker} ${indent(body, " ".repeat(marker.length + 1))}`;
        })
        .join("\n");
    case "table": {
      const rows = children.map((row) =>
        (row.content || []).map((cell) =>
          // Text pipes are already escaped by escapeMd; catch any left in code.
          (cell.content || []).map((n) => blockMd(n)).join(" ").replace(/(?<!\\)\|/g, "\\|").replace(/\n/g, " "),
        ),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r) => [...r, ...Array(width - r.length).fill("")];
      const [head, ...body] = rows.map(pad);
      return [
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...body.map((r) => `| ${r.join(" | ")} |`),
      ].join("\n");
    }
    default:
      return children.length ? children.map((n) => blockMd(n, depth)).join("\n") : "";
  }
};

export const docToMarkdown = (doc) => (doc ? blockMd(doc).trim() : "");

/* ============================== HTML ============================== */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const inlineHtml = (nodes = []) =>
  nodes
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      if (node.type === "image") return `<img src="${escapeHtml(node.attrs?.src)}" alt="${escapeHtml(node.attrs?.alt)}">`;
      if (node.type !== "text") return "";
      let html = escapeHtml(node.text);
      (node.marks || []).forEach((mark) => {
        if (mark.type === "bold") html = `<strong>${html}</strong>`;
        if (mark.type === "italic") html = `<em>${html}</em>`;
        if (mark.type === "underline") html = `<u>${html}</u>`;
        if (mark.type === "strike") html = `<s>${html}</s>`;
        if (mark.type === "code") html = `<code>${html}</code>`;
        if (mark.type === "highlight") html = `<span style="background:#fde68a">${html}</span>`;
        if (mark.type === "link") html = `<a href="${escapeHtml(mark.attrs?.href)}">${html}</a>`;
      });
      return html;
    })
    .join("");

const blockHtml = (node) => {
  const inner = () => (node.content || []).map(blockHtml).join("");
  switch (node.type) {
    case "doc":
      return inner();
    case "paragraph":
      return `<p>${inlineHtml(node.content)}</p>`;
    case "heading": {
      const level = Math.min(6, (node.attrs?.level || 1) + 1); // h1 is reserved for the note title
      return `<h${level}>${inlineHtml(node.content)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${inner()}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml((node.content || []).map((c) => c.text || "").join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "image":
      return `<p><img src="${escapeHtml(node.attrs?.src)}" alt="${escapeHtml(node.attrs?.alt)}"></p>`;
    case "bulletList":
      return `<ul>${inner()}</ul>`;
    case "orderedList":
      return `<ol>${inner()}</ol>`;
    case "listItem":
      return `<li>${inner()}</li>`;
    case "taskList":
      return `<ul>${(node.content || [])
        .map((item) => `<li>${item.attrs?.checked ? "☑" : "☐"} ${(item.content || []).map(blockHtml).join("")}</li>`)
        .join("")}</ul>`;
    case "table":
      return `<table border="1" cellpadding="6" style="border-collapse:collapse">${(node.content || [])
        .map(
          (row) =>
            `<tr>${(row.content || [])
              .map((cell) => {
                const tag = cell.type === "tableHeader" ? "th" : "td";
                return `<${tag}>${(cell.content || []).map(blockHtml).join("")}</${tag}>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</table>`;
    default:
      return inner();
  }
};

export const docToHtml = (doc) => (doc ? blockHtml(doc) : "");
export { escapeHtml };

/* =============================== Ink ============================== */

const hasRealPressure = (points) => points.some((p) => p[2] !== points[0][2]) || points[0]?.[2] !== 0.5;

export const strokeToPath = (element) => {
  const isHighlighter = element.tool === "highlighter";
  const outline = getStroke(element.points, {
    size: element.size,
    thinning: isHighlighter ? 0 : 0.6,
    smoothing: 0.5,
    streamline: isHighlighter ? 0.6 : 0.45,
    simulatePressure: !isHighlighter && !hasRealPressure(element.points),
    start: { cap: true },
    end: { cap: true },
    last: true,
  });
  if (!outline.length) return "";

  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
      return acc;
    },
    ["M", ...outline[0].map((n) => n.toFixed(2)), "Q"],
  );
  d.push("Z");
  return d.join(" ");
};

export const inkBounds = (elements) => {
  let maxY = 0;
  elements.forEach((el) => {
    if (el.type === "stroke") el.points.forEach((p) => (maxY = Math.max(maxY, p[1] + el.size)));
    else if (el.type === "shape") maxY = Math.max(maxY, el.y1, el.y2);
    else maxY = Math.max(maxY, el.y + el.h);
  });
  return { maxY };
};
