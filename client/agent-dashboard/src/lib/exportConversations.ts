import { Conversation, Message } from '../../../../shared/src/types';
import { API_URL } from './config';

const BACKEND_URL = API_URL;

const fetchMessages = async (convId: string, token: string): Promise<Message[]> => {
  const res = await fetch(`${BACKEND_URL}/api/messages/${convId}?limit=100000`, { headers: { 'Authorization': `Bearer ${token}` } });
  return res.ok ? res.json() : [];
};

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const speaker = (m: Message) =>
  m.sender.type === 'system' ? 'Event'
  : m.isInternalNote ? `${m.sender.name} (internal note)`
  : m.metadata?.type === 'auto_reply' ? `${m.sender.name} (automated)`
  : m.sender.name;

const header = (c: Conversation) => [
  `${c.ticketNumber}${c.title ? ` — ${c.title}` : ''}`,
  `Customer: ${c.customer.name}${c.customer.email ? ` <${c.customer.email}>` : ''}`,
  `State: ${c.status} · Priority: ${c.priority} · Category: ${c.category}`,
  `Started: ${when(c.createdAt)}`,
];

const fileStamp = () => new Date().toISOString().slice(0, 10);

/** Download one or more conversations (with notes and events) as a .txt file. */
export async function exportAsText(convs: Conversation[], token: string) {
  const parts: string[] = [];
  for (const c of convs) {
    const msgs = await fetchMessages(c.id, token);
    parts.push([
      ...header(c),
      '',
      ...msgs.map(m => {
        const files = m.attachments?.length ? `  [attachments: ${m.attachments.map(a => a.url).join(', ')}]` : '';
        return `[${when(m.createdAt)}] ${speaker(m)}: ${m.content}${files}`;
      }),
    ].join('\n'));
  }
  const blob = new Blob([parts.join('\n\n' + '─'.repeat(60) + '\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = convs.length === 1 ? `ticket-${convs[0].ticketNumber.replace(/^#/, "")}.txt` : `chai-shots-conversations-${fileStamp()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Open a print-ready view of the conversations; the browser's print dialog saves it as PDF.
 * The window is opened synchronously (before any await) so popup blockers allow it.
 */
export async function exportAsPdf(convs: Conversation[], token: string) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups for this site to export as PDF.'); return; }
  w.document.write('<p style="font-family:system-ui;padding:24px">Preparing export…</p>');
  const sections: string[] = [];
  for (const c of convs) {
    const msgs = await fetchMessages(c.id, token);
    sections.push(`
      <section>
        <h2>${esc(c.ticketNumber)}${c.title ? ` — ${esc(c.title)}` : ''}</h2>
        <p class="meta">${header(c).slice(1).map(esc).join('<br>')}</p>
        ${msgs.map(m => `
          <div class="msg ${m.sender.type === 'system' ? 'event' : m.isInternalNote ? 'note' : m.sender.type}">
            <div class="who">${esc(speaker(m))} <span>${esc(when(m.createdAt))}</span></div>
            <div class="body">${esc(m.content || '')}${m.attachments?.length ? `<div class="att">Attachments: ${m.attachments.map(a => esc(a.name)).join(', ')}</div>` : ''}</div>
          </div>`).join('')}
      </section>`);
  }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${convs.length === 1 ? esc(convs[0].ticketNumber) : 'Conversations'} — Chai Shots</title>
    <style>
      body{font-family:Inter,system-ui,sans-serif;color:#1a1a1a;margin:32px;font-size:13px}
      h2{font-size:18px;margin:0 0 4px}
      section{page-break-after:always;margin-bottom:32px}
      .meta{color:#6e6e6a;margin:0 0 16px}
      .msg{padding:8px 12px;border-radius:10px;margin:6px 0;background:#f4f4f2;max-width:90%;white-space:pre-wrap}
      .msg.agent{background:#dce7fb;margin-left:auto}
      .msg.note{background:#fef6db;border:1px solid #f5dea0;margin-left:auto}
      .msg.event{background:none;color:#6e6e6a;padding:2px 12px;font-size:12px}
      .who{font-weight:600;font-size:12px;margin-bottom:2px}.who span{font-weight:400;color:#9c9b97}
      .att{color:#6e6e6a;font-size:12px;margin-top:4px}
      @media print{body{margin:12mm}}
    </style></head><body>${sections.join('')}
    <script>window.onload=()=>{window.focus();window.print();}</script></body></html>`);
  w.document.close();
}
