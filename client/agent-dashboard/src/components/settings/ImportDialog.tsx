import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileUp, Upload, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { BACKEND_URL } from './shared';

type Result = { created: number; updated: number; collectionsCreated?: number; skipped: { source: string; reason: string }[]; skippedCount: number };

/**
 * "Import" for the knowledge base (CSV or Markdown files) and macros (CSV): explains the format, offers an
 * example file, uploads, and shows what was created, updated or skipped.
 */
export const ImportDialog: React.FC<{
  kind: 'articles' | 'macros';
  onClose: () => void;
  onImported: () => void;
}> = ({ kind, onClose, onImported }) => {
  const token = useStore(s => s.token);
  const fileRef = useRef<HTMLInputElement>(null);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const articles = kind === 'articles';

  const example = articles
    ? 'title,body,collection,state\n"How do I reset my password?","Open the app, tap **Sign in**, then **Forgot password**. We email you a link that works for 30 minutes.",Account,published\n"Can I get a refund?","Yes, within 14 days of purchase. Reply here with your order number.",Billing,draft\n'
    : 'shortcut,title,message\n/refund,Refund policy,"Refunds are possible within 14 days of purchase. Could you share your order number?"\n/thanks,Thanks,"Thanks for reaching out! Is there anything else I can help with?"\n';

  const downloadExample = () => {
    const url = URL.createObjectURL(new Blob([example], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = articles ? 'articles-example.csv' : 'macros-example.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const files = await Promise.all(Array.from(list).slice(0, 200).map(async f => ({ name: f.name, content: await f.text() })));
      const total = files.reduce((n, f) => n + f.content.length, 0);
      if (total > 5_000_000) throw new Error('These files are too big together (over 5 MB). Import them in smaller batches.');
      const res = await fetch(`${BACKEND_URL}/api/${articles ? 'help/import' : 'saved-replies/import'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(articles ? { files, publish } : { name: files[0].name, content: files[0].content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setResult(data);
      if (data.created || data.updated) onImported();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-ink/25 flex items-center justify-center p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-[560px] max-w-full bg-surface rounded-2xl shadow-pop border border-line overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line">
          <FileUp className="w-[18px] h-[18px] text-muted" />
          <h3 className="flex-1 text-[16px] font-semibold text-ink">{articles ? 'Import articles' : 'Import macros'}</h3>
          <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3 text-[13.5px] text-muted leading-relaxed">
          {articles ? (
            <>
              <p><span className="text-ink font-medium">CSV:</span> one article per row, with columns <code className="ic-kbd">title</code>, <code className="ic-kbd">body</code> (the answer), and optionally <code className="ic-kbd">collection</code> and <code className="ic-kbd">state</code> (published or draft).</p>
              <p><span className="text-ink font-medium">Markdown or text files:</span> one article per file. The first line <code className="ic-kbd"># Title</code> (or the file name) becomes the title; the rest is the answer. Select many files at once.</p>
              <p>Collections that don’t exist yet are created. An article with the same title as an existing one is updated, not duplicated.</p>
              <label className="flex items-center gap-2 text-ink cursor-pointer">
                <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} />
                Publish imported articles (unless a row says draft)
              </label>
            </>
          ) : (
            <>
              <p><span className="text-ink font-medium">CSV:</span> one macro per row, with columns <code className="ic-kbd">shortcut</code> (what you type after <code className="ic-kbd">/</code>), <code className="ic-kbd">title</code> and <code className="ic-kbd">message</code>.</p>
              <p>A macro with the same shortcut as an existing one is updated. Imported macros are available to everyone; add actions afterwards if you need them.</p>
            </>
          )}
          <button onClick={downloadExample} className="self-start inline-flex items-center gap-1.5 text-[13px] text-ink hover:underline">
            <Download className="w-3.5 h-3.5" /> Download an example file
          </button>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          {result && (
            <div className="rounded-xl border border-line p-3 text-[13.5px] text-ink">
              <p className="font-medium">
                {result.created} created · {result.updated} updated{result.collectionsCreated ? ` · ${result.collectionsCreated} new collection${result.collectionsCreated === 1 ? '' : 's'}` : ''}{result.skippedCount ? ` · ${result.skippedCount} skipped` : ''}
              </p>
              {result.skipped.length > 0 && (
                <ul className="mt-1.5 text-[12.5px] text-muted list-disc pl-4 max-h-28 overflow-y-auto">
                  {result.skipped.map((s, i) => <li key={i}>{s.source}: {s.reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">
          <input ref={fileRef} type="file" className="hidden" multiple={articles}
            accept={articles ? '.csv,.md,.markdown,.txt,text/csv,text/markdown,text/plain' : '.csv,text/csv'}
            onChange={e => upload(e.target.files)} />
          <button onClick={onClose} className="ic-btn-secondary" disabled={busy}>{result ? 'Done' : 'Cancel'}</button>
          <button onClick={() => fileRef.current?.click()} className="ic-btn-primary" disabled={busy}>
            <Upload className="w-4 h-4" /> {busy ? 'Importing…' : articles ? 'Choose files' : 'Choose a CSV file'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImportDialog;
