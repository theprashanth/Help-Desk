import React from 'react';

/*
 * Message formatting: messages are stored as plain text with light markdown
 * (**bold**, *italic*, `code`, [label](https://link)). Pasting formatted text (Google Sheets,
 * Docs, web pages) converts its bold/italic into these markers so it survives.
 */

// ── Rendering ───────────────────────────────────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only real web/mail links may become <a> — never javascript: or data: URLs. */
const safeHref = (raw: string) => {
  const url = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^www\./i.test(url)) return 'https://' + url;
  return null;
};

export function markdownToHtml(text: string, codeClass = '', linkClass = ''): string {
  if (!text) return '';
  // Pull out code spans first so their contents aren't formatted
  const codes: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = escapeHtml(s);
  // Links: label and URL are already escaped; unsafe schemes stay as plain text
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${label}</a>` : m;
  });
  // **bold** (also __bold__), then *italic* — markers must hug the text, so "2 * 3 * 4" stays as is
  s = s.replace(/\*\*\*(?=\S)([^\n]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(?=\S)([^\n]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^\n*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="${codeClass}">${escapeHtml(codes[+i])}</code>`);
  return s;
}

/** Renders a message body (keeps line breaks; caller supplies whitespace-pre-wrap). */
export const RichText: React.FC<{ text: string; codeClass?: string; linkClass?: string; className?: string }> = ({ text, codeClass, linkClass, className }) =>
  text ? <div className={className} dangerouslySetInnerHTML={{ __html: markdownToHtml(text, codeClass, linkClass) }} /> : null;

/** Plain text for previews/notifications: drops the markers. */
export const stripMarkdown = (text: string) =>
  (text || '')
    .replace(/\*\*\*(?=\S)([^\n]*?\S)\*\*\*/g, '$1')
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([^\n]*?\S)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1');

// ── Pasting ─────────────────────────────────────────────────────────────────

type Run = { text: string; bold: boolean; italic: boolean };
const BLOCK = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'SECTION', 'ARTICLE']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'META', 'COLGROUP']);

function weightOf(el: HTMLElement, inherited: boolean): boolean {
  const w = el.style?.fontWeight;
  if (w) return w === 'bold' || w === 'bolder' || (+w >= 600);
  if (/^(B|STRONG|TH|H[1-6])$/.test(el.tagName)) return true;
  return inherited;
}
function italicOf(el: HTMLElement, inherited: boolean): boolean {
  const s = el.style?.fontStyle;
  if (s) return s === 'italic' || s === 'oblique';
  if (/^(I|EM)$/.test(el.tagName)) return true;
  return inherited;
}

/** Walks formatted DOM and returns text with **bold** / *italic* markers, plus whether any formatting was found. */
export function nodeToMarkdown(root: Node, preserveWhitespace = false): { text: string; formatted: boolean } {
  const runs: Run[] = [];
  const push = (text: string, bold: boolean, italic: boolean) => {
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  };
  const endsWithBreak = () => { const l = runs[runs.length - 1]; return !l || l.text.endsWith('\n'); };
  const newline = () => push('\n', false, false);
  const cells: number[] = []; // separate table cells in the same row with a tab

  const walk = (node: Node, bold: boolean, italic: boolean, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let t = (node.textContent || '').replace(/\u00a0/g, ' ');
      if (!pre) t = t.replace(/[ \t\r\n]+/g, ' ');
      if (t) push(t, bold, italic);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === 'BR') { newline(); return; }
    if (el.tagName === 'CODE' && node !== root) { push('`' + (el.textContent || '') + '`', false, false); return; }
    const isEl = node.nodeType === Node.ELEMENT_NODE && node !== root;
    const b = isEl ? weightOf(el, bold) : bold, i = isEl ? italicOf(el, italic) : italic;
    const ws = (isEl && el.style?.whiteSpace) || '';
    const p = pre || el.tagName === 'PRE' || ws.startsWith('pre') || ws === 'break-spaces';
    const block = isEl && BLOCK.has(el.tagName);
    if (block && !endsWithBreak()) newline(); // e.g. text<div>next line</div>
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      if (cells.length && cells[cells.length - 1] > 0) push('\t', false, false);
      if (cells.length) cells[cells.length - 1]++;
    }
    if (el.tagName === 'TR') cells.push(0);
    if (el.tagName === 'LI') push(el.parentElement?.tagName === 'OL' ? `${[...el.parentElement.children].indexOf(el) + 1}. ` : '• ', false, false);
    el.childNodes.forEach(c => walk(c, b, i, p));
    if (el.tagName === 'TR') cells.pop();
    if (block && !endsWithBreak()) newline();
  };
  walk(root, false, false, preserveWhitespace);

  // Wrap each formatted run line by line; markers go around the words, never around spaces
  let out = '';
  for (const r of runs) {
    if (!r.bold && !r.italic) { out += r.text; continue; }
    const mark = r.bold && r.italic ? '***' : r.bold ? '**' : '*';
    out += r.text.split('\n').map(line => {
      const m = line.match(/^(\s*)(.*?)(\s*)$/s)!;
      return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : line;
    }).join('\n');
  }
  return { text: out, formatted: runs.some(r => (r.bold || r.italic) && r.text.trim() !== '') };
}

/** Converts pasted HTML into text with **bold** / *italic* markers. Returns null if there's no formatting worth keeping. */
export function htmlToMarkdown(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const { text, formatted } = nodeToMarkdown(doc.body);
  if (!formatted) return null;
  return text
    .replace(/[ \t]+\n/g, '\n')   // trailing spaces
    .replace(/\n{3,}/g, '\n\n')   // stacked block breaks
    .trim();
}

/** HTML for showing markdown inside an editable box (line breaks as <br>). */
export const markdownToEditorHtml = (text: string) => markdownToHtml(text).replace(/\n/g, '<br>');

/** Spreadsheets quote multi-line cells in plain text: "line 1\nsay ""hi""" → line 1\nsay "hi" */
export function unquoteSpreadsheetCell(text: string): string {
  const m = text.match(/^"([\s\S]*)"\r?\n?$/);
  if (!m || !/\n/.test(m[1])) return text;
  if (/(^|[^"])"([^"]|$)/.test(m[1].replace(/""/g, ''))) return text; // a lone quote inside: not a quoted cell
  return m[1].replace(/""/g, '"');
}

/** What a paste should insert: formatted HTML → markdown, else cleaned plain text. Null = let the browser paste normally. */
export function pastedText(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (html) {
    const md = htmlToMarkdown(html);
    if (md) return md;
  }
  const plain = data.getData('text/plain');
  if (!plain) return null;
  const cleaned = unquoteSpreadsheetCell(plain);
  return cleaned !== plain ? cleaned : null;
}

/**
 * onPaste helper for controlled <textarea>/<input>: inserts the converted text at the cursor.
 * Returns true if it handled the paste.
 */
export function handleFormattedPaste(
  e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  setValue: (v: string) => void,
): boolean {
  const text = pastedText(e.clipboardData);
  if (text === null) return false;
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setValue(next);
  const caret = start + text.length;
  requestAnimationFrame(() => { try { el.setSelectionRange(caret, caret); } catch { /* detached */ } });
  return true;
}
