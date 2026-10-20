import { createRequire } from "node:module";
import path from "node:path";
import PDFDocument from "pdfkit";
import { strokeToPath, inkBounds } from "./notes.convert.js";
import logger from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Note → PDF (A4). Typed notes become real, selectable text; handwritten
// notes are drawn as vectors (the same perfect-freehand outlines as the
// editor) and split across pages. Fonts are Inter + JetBrains Mono (WOFF —
// pdfkit's subsetter chokes on WOFF2).
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const fontFile = (pkg, name) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files", name);

const FONTS = {
  regular: fontFile("@fontsource/inter", "inter-latin-400-normal.woff"),
  italic: fontFile("@fontsource/inter", "inter-latin-400-italic.woff"),
  bold: fontFile("@fontsource/inter", "inter-latin-700-normal.woff"),
  boldItalic: fontFile("@fontsource/inter", "inter-latin-700-italic.woff"),
  semibold: fontFile("@fontsource/inter", "inter-latin-600-normal.woff"),
  mono: fontFile("@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff"),
};

const PAGE = { size: "A4", margin: 56 };
const INK = "#111111";
const MUTED = "#6b7280";
const BORDER = "#d4d4d8";
const LINK = "#2a78d6";
const BODY_SIZE = 10.5;
const INK_PAGE_WIDTH = 1000; // editor page units

/* ---------- images ---------- */

const imageCache = new Map();

const loadImage = async (url) => {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);

  // Cloudinary can hand us a JPEG at a sensible size (pdfkit only reads PNG/JPEG).
  const src = url.includes("/upload/") ? url.replace("/upload/", "/upload/f_jpg,q_85,w_1600,c_limit/") : url;
  let result = null;
  try {
    const response = await fetch(src, { signal: AbortSignal.timeout(8000) });
    const type = response.headers.get("content-type") || "";
    if (response.ok && /image\/(jpe?g|png)/.test(type)) {
      result = Buffer.from(await response.arrayBuffer());
    }
  } catch (error) {
    logger.warn({ action: "PDF_IMAGE_FAILED", url, error: error.message });
  }
  imageCache.set(url, result);
  return result;
};

const collectImageUrls = (node, out = []) => {
  if (!node) return out;
  if (node.type === "image" && node.attrs?.src) out.push(node.attrs.src);
  (node.content || []).forEach((child) => collectImageUrls(child, out));
  return out;
};

/* ---------- typed notes ---------- */

const fontFor = (marks = []) => {
  const has = (t) => marks.some((m) => m.type === t);
  if (has("code")) return "mono";
  if (has("bold") && has("italic")) return "boldItalic";
  if (has("bold")) return "bold";
  if (has("italic")) return "italic";
  return "regular";
};

class TypedRenderer {
  constructor(doc, images) {
    this.doc = doc;
    this.images = images;
    this.left = doc.page.margins.left;
    this.width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  ensureSpace(height) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  // Rich inline runs; `indent` shifts the block right (lists, quotes).
  inline(nodes = [], { indent = 0, size = BODY_SIZE, baseFont = "regular", color = INK, gap = 6 } = {}) {
    const doc = this.doc;
    const runs = [];
    nodes.forEach((node) => {
      if (node.type === "text") runs.push(node);
      else if (node.type === "hardBreak") runs.push({ type: "text", text: "\n" });
    });
    if (!runs.length) {
      doc.moveDown(0.4);
      return;
    }

    this.ensureSpace(size * 1.6);
    const x = this.left + indent;
    const width = this.width - indent;
    doc.x = x;

    runs.forEach((run, i) => {
      const marks = run.marks || [];
      let font = fontFor(marks);
      if (font === "regular" && baseFont !== "regular") font = baseFont;
      const link = marks.find((m) => m.type === "link")?.attrs?.href;
      const isCode = font === "mono";

      doc
        .font(font)
        .fontSize(isCode ? size * 0.92 : size)
        .fillColor(link ? LINK : isCode ? "#be185d" : marks.some((m) => m.type === "highlight") ? "#92400e" : color);

      const options = {
        width,
        continued: i < runs.length - 1,
        lineGap: 2.5,
        underline: Boolean(link) || marks.some((m) => m.type === "underline"),
        strike: marks.some((m) => m.type === "strike"),
      };
      if (link) options.link = link;
      if (i === 0) doc.text(run.text, x, doc.y, options);
      else doc.text(run.text, options);
    });

    doc.fillColor(INK);
    doc.y += gap;
    doc.x = this.left;
  }

  async block(node, indent = 0) {
    const doc = this.doc;
    const children = node.content || [];

    switch (node.type) {
      case "paragraph":
        this.inline(children, { indent });
        break;

      case "heading": {
        const level = node.attrs?.level || 1;
        const size = { 1: 18, 2: 15, 3: 12.5 }[level] || 12;
        this.ensureSpace(size * 3);
        doc.y += level === 1 ? 10 : 6;
        this.inline(children, { indent, size, baseFont: "bold", gap: 6 });
        break;
      }

      case "bulletList":
      case "orderedList":
      case "taskList": {
        let n = node.attrs?.start || 1;
        for (const item of children) {
          this.ensureSpace(BODY_SIZE * 1.8);
          const markerY = doc.y;
          const markerX = this.left + indent;
          if (node.type === "taskList") {
            doc.save().lineWidth(0.8).strokeColor(MUTED).roundedRect(markerX, markerY + 1.5, 9, 9, 2).stroke();
            if (item.attrs?.checked) {
              doc.lineWidth(1.4).strokeColor(LINK).moveTo(markerX + 2, markerY + 6).lineTo(markerX + 4, markerY + 8.5).lineTo(markerX + 7.5, markerY + 3).stroke();
            }
            doc.restore();
          } else {
            const marker = node.type === "orderedList" ? `${n}.` : "•";
            doc.font("regular").fontSize(BODY_SIZE).fillColor(MUTED).text(marker, markerX, markerY, { lineBreak: false });
            doc.fillColor(INK);
          }
          n += 1;
          doc.y = markerY;
          for (const child of item.content || []) {
            // eslint-disable-next-line no-await-in-loop
            await this.block(child, indent + 16);
          }
          if (node.type === "taskList" && item.attrs?.checked) doc.fillColor(INK);
        }
        doc.y += 2;
        break;
      }

      case "blockquote": {
        const startY = doc.y;
        const startPage = doc.page;
        for (const child of children) {
          // eslint-disable-next-line no-await-in-loop
          await this.block(child, indent + 14);
        }
        if (doc.page === startPage) {
          doc.save().lineWidth(2.5).strokeColor(BORDER).moveTo(this.left + indent + 3, startY).lineTo(this.left + indent + 3, doc.y - 6).stroke().restore();
        }
        break;
      }

      case "codeBlock": {
        const text = children.map((c) => c.text || "").join("");
        doc.font("mono").fontSize(9);
        const width = this.width - indent - 20;
        const height = doc.heightOfString(text || " ", { width, lineGap: 2 }) + 18;
        if (height < this.bottom - doc.page.margins.top) this.ensureSpace(height);
        const y = doc.y;
        doc.save().roundedRect(this.left + indent, y, this.width - indent, height, 6).fill("#f3f4f6").restore();
        doc.font("mono").fontSize(9).fillColor("#1f2937").text(text, this.left + indent + 10, y + 9, { width, lineGap: 2 });
        doc.fillColor(INK);
        doc.y = Math.max(doc.y, y + height) + 8;
        doc.x = this.left;
        break;
      }

      case "horizontalRule":
        this.ensureSpace(16);
        doc.y += 6;
        doc.save().lineWidth(0.6).strokeColor(BORDER).moveTo(this.left, doc.y).lineTo(this.left + this.width, doc.y).stroke().restore();
        doc.y += 10;
        break;

      case "image": {
        const buffer = this.images.get(node.attrs?.src);
        if (!buffer) {
          this.inline([{ type: "text", text: `[image: ${node.attrs?.src || ""}]` }], { indent, color: MUTED });
          break;
        }
        const img = doc.openImage(buffer);
        const width = Math.min(this.width - indent, img.width);
        const height = (img.height / img.width) * width;
        const maxHeight = this.bottom - doc.page.margins.top;
        const scale = height > maxHeight ? maxHeight / height : 1;
        this.ensureSpace(height * scale + 8);
        doc.image(img, this.left + indent, doc.y, { width: width * scale, height: height * scale });
        doc.y += height * scale + 10;
        break;
      }

      case "table": {
        const rows = children;
        if (!rows.length) break;
        const cols = Math.max(...rows.map((r) => (r.content || []).length));
        const colWidth = (this.width - indent) / cols;
        const pad = 5;
        const cellText = (cell) =>
          (cell.content || [])
            .map((p) => (p.content || []).filter((t) => t.type === "text").map((t) => t.text).join(""))
            .join("\n");

        doc.y += 4;
        for (const row of rows) {
          const cells = row.content || [];
          const isHeader = cells.some((c) => c.type === "tableHeader");
          doc.font(isHeader ? "semibold" : "regular").fontSize(9.5);
          const rowHeight =
            Math.max(...cells.map((c) => doc.heightOfString(cellText(c) || " ", { width: colWidth - pad * 2 }))) + pad * 2;
          this.ensureSpace(rowHeight);
          const y = doc.y;
          cells.forEach((cell, i) => {
            const x = this.left + indent + i * colWidth;
            if (isHeader) doc.save().rect(x, y, colWidth, rowHeight).fill("#f3f4f6").restore();
            doc.save().lineWidth(0.6).strokeColor(BORDER).rect(x, y, colWidth, rowHeight).stroke().restore();
            doc.font(isHeader ? "semibold" : "regular").fontSize(9.5).fillColor(INK).text(cellText(cell), x + pad, y + pad, { width: colWidth - pad * 2 });
          });
          doc.y = y + rowHeight;
        }
        doc.y += 10;
        doc.x = this.left;
        break;
      }

      default:
        for (const child of children) {
          // eslint-disable-next-line no-await-in-loop
          await this.block(child, indent);
        }
    }
  }
}

/* ---------- handwritten notes ---------- */

const drawPaper = (doc, paper, scale, unitsTop, unitsHeight) => {
  const spacing = 32;
  doc.save();
  if (paper === "lined") {
    doc.lineWidth(0.5).strokeColor("#c7d7ee");
    for (let y = Math.ceil(unitsTop / spacing) * spacing; y < unitsTop + unitsHeight; y += spacing) {
      const py = (y - unitsTop) * scale;
      doc.moveTo(0, py).lineTo(INK_PAGE_WIDTH * scale, py).stroke();
    }
    doc.strokeColor("#f2b8b8").lineWidth(0.6).moveTo(72 * scale, 0).lineTo(72 * scale, unitsHeight * scale).stroke();
  } else if (paper === "grid") {
    doc.lineWidth(0.4).strokeColor("#dbe3ee");
    for (let y = Math.ceil(unitsTop / spacing) * spacing; y < unitsTop + unitsHeight; y += spacing) {
      doc.moveTo(0, (y - unitsTop) * scale).lineTo(INK_PAGE_WIDTH * scale, (y - unitsTop) * scale).stroke();
    }
    for (let x = 0; x <= INK_PAGE_WIDTH; x += spacing) {
      doc.moveTo(x * scale, 0).lineTo(x * scale, unitsHeight * scale).stroke();
    }
  } else if (paper === "dotted") {
    doc.fillColor("#b8c2cf");
    for (let y = Math.ceil(unitsTop / spacing) * spacing + spacing / 2; y < unitsTop + unitsHeight; y += spacing) {
      for (let x = spacing / 2; x < INK_PAGE_WIDTH; x += spacing) doc.circle(x * scale, (y - unitsTop) * scale, 0.7).fill();
    }
  }
  doc.restore();
};

const renderInk = async (doc, ink, startY) => {
  const elements = ink?.elements || [];
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const scale = width / INK_PAGE_WIDTH;

  const images = new Map();
  await Promise.all(
    elements.filter((e) => e.type === "image").map(async (e) => images.set(e.url, await loadImage(e.url))),
  );

  const totalUnits = Math.max(600, inkBounds(elements).maxY + 40);
  const paths = new Map(elements.filter((e) => e.type === "stroke").map((e) => [e.id, strokeToPath(e)]));

  let unitsTop = 0;
  let pageTop = startY;
  while (unitsTop < totalUnits) {
    const available = doc.page.height - doc.page.margins.bottom - pageTop;
    const unitsHeight = Math.min(available / scale, totalUnits - unitsTop);

    doc.save();
    doc.rect(left, pageTop, width, unitsHeight * scale).clip();
    doc.translate(left, pageTop);
    drawPaper(doc, ink?.paper || "lined", scale, unitsTop, unitsHeight);
    doc.scale(scale).translate(0, -unitsTop);

    // Highlighter goes underneath the ink, like a real marker over a page.
    const ordered = [
      ...elements.filter((e) => e.tool === "highlighter"),
      ...elements.filter((e) => e.tool !== "highlighter"),
    ];
    for (const el of ordered) {
      if (el.type === "stroke") {
        const d = paths.get(el.id);
        if (!d) continue;
        doc.save();
        if (el.tool === "highlighter") doc.fillOpacity(0.38);
        doc.path(d).fill(el.color);
        doc.restore();
      } else if (el.type === "shape") {
        doc.save().lineWidth(el.size).strokeColor(el.color).lineCap("round").lineJoin("round");
        const x = Math.min(el.x1, el.x2);
        const y = Math.min(el.y1, el.y2);
        const w = Math.abs(el.x2 - el.x1);
        const h = Math.abs(el.y2 - el.y1);
        if (el.shape === "line") doc.moveTo(el.x1, el.y1).lineTo(el.x2, el.y2).stroke();
        else if (el.shape === "rect") doc.roundedRect(x, y, w, h, 2).stroke();
        else doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2).stroke();
        doc.restore();
      } else if (el.type === "image") {
        const buffer = images.get(el.url);
        if (buffer) doc.image(buffer, el.x, el.y, { width: el.w, height: el.h });
      }
    }
    doc.restore();

    unitsTop += unitsHeight;
    if (unitsTop < totalUnits) {
      doc.addPage();
      pageTop = doc.page.margins.top;
    }
  }
};

/* ---------- document ---------- */

export const renderNotePdf = async (note, { breadcrumb = "" } = {}) => {
  const doc = new PDFDocument({
    ...PAGE,
    info: { Title: note.title || "Note", Author: "Suryanshu Verma", Creator: "Portfolio Notes" },
    bufferPages: true,
  });
  Object.entries(FONTS).forEach(([name, file]) => doc.registerFont(name, file));

  // Header
  doc.font("bold").fontSize(22).fillColor(INK).text(note.title || "Untitled", { width: doc.page.width - 112 });
  const updated = new Date(note.updatedAt || Date.now()).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  doc.moveDown(0.3).font("regular").fontSize(9).fillColor(MUTED).text([breadcrumb, `Updated ${updated}`].filter(Boolean).join("  ·  "));
  if (note.tags?.length) doc.text(note.tags.map((t) => `#${t}`).join("  "));
  doc.moveDown(0.6);
  doc.save().lineWidth(0.6).strokeColor(BORDER).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke().restore();
  doc.moveDown(1).fillColor(INK);

  if (note.kind === "handwritten") {
    await renderInk(doc, note.ink, doc.y);
  } else {
    const urls = [...new Set(collectImageUrls(note.doc))];
    const images = new Map(await Promise.all(urls.map(async (u) => [u, await loadImage(u)])));
    const renderer = new TypedRenderer(doc, images);
    for (const block of note.doc?.content || []) {
      // eslint-disable-next-line no-await-in-loop
      await renderer.block(block);
    }
  }

  // Footer page numbers.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("regular").fontSize(8).fillColor(MUTED).text(`${i + 1} / ${range.count}`, 0, doc.page.height - 32, { align: "center", width: doc.page.width });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return doc;
};
