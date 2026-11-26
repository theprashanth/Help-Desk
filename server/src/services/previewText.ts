/**
 * Inbox / Messenger preview of a message: a markdown table reads as its cells
 * ("Plan · Price · Pro · $20"), not as "| --- |" rows.
 */
export function previewText(content: string): string {
  if (!content || !content.includes('|')) return content;
  return content
    .split('\n')
    .filter(line => !/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?\s*)?\|?\s*$/.test(line))
    .map(line => (/^\s*\|.*\|\s*$/.test(line) ? line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean).join(' · ') : line))
    .join('\n');
}
