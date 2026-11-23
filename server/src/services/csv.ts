/**
 * Small, dependency-free CSV reader/writer (RFC 4180): quoted fields, "" escapes, commas and
 * newlines inside quotes, CRLF/LF, a UTF-8 BOM, and ; or tab separators when a file uses them.
 */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = count(',') >= count(';') && count(',') >= count('\t') ? ',' : count(';') >= count('\t') ? ';' : '\t';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

/** Header row + objects keyed by header (duplicate headers get " (2)", " (3)"…). */
export function parseCsvObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(text);
  const seen = new Map<string, number>();
  const headers = head.map(h => {
    const base = h.trim() || 'Column';
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = body.map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Formula-looking cells are prefixed so spreadsheets don't execute them
  // (phone numbers and negative numbers like "+91 98…" or "-12.5" are left alone)
  const safe = /^[=@\t\r]/.test(s) || /^[+-](?![\d\s(])/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
