import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle, Check, Megaphone, MessageCircle, PanelTop } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent, CustomAttributeDef, OutboundMessage } from '../../../../../shared/src/types';
import { RichText } from '../../lib/richText';
import { BACKEND_URL, SettingsPageHeader } from './shared';

type Draft = {
  name: string; kind: 'chat' | 'banner'; body: string; senderId: string;
  linkLabel: string; linkUrl: string; bannerStyle: 'info' | 'promo';
  people: 'everyone' | 'leads' | 'users'; pageOp: 'contains' | 'equals' | 'starts_with'; pageValue: string;
  attrKey: string; attrValue: string; frequency: 'once' | 'every_page'; state: 'live' | 'paused';
};
const toDraft = (m?: OutboundMessage, me?: string): Draft => ({
  name: m?.name || '', kind: m?.kind || 'chat', body: m?.body || '', senderId: m?.senderId || me || '',
  linkLabel: m?.link?.label || '', linkUrl: m?.link?.url || '', bannerStyle: m?.bannerStyle || 'info',
  people: m?.audience.people || 'everyone', pageOp: m?.audience.pageUrl?.op || 'contains', pageValue: m?.audience.pageUrl?.value || '',
  attrKey: m?.audience.attribute?.key || '', attrValue: m?.audience.attribute?.value || '',
  frequency: m?.frequency || 'once', state: m?.state || 'paused',
});

/**
 * Settings › Proactive messages: Messenger chat messages and page banners shown to the people and
 * pages you choose. Chat messages pop up from the launcher; replying starts a conversation.
 */
export default function OutboundSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';
  const [list, setList] = useState<OutboundMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [attrs, setAttrs] = useState<CustomAttributeDef[]>([]);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [d, setD] = useState<Draft>(toDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BACKEND_URL}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || 'Something went wrong');
    return x;
  };
  const load = () => call('GET', '/outbound').then(setList).catch(e => setError(e.message));
  useEffect(() => {
    if (!token) return;
    load();
    call('GET', '/auth/agents').then(setAgents).catch(() => {});
    call('GET', '/people-attributes').then(setAttrs).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = list.find(m => m.id === selected);
  useEffect(() => { setError(null); setD(selected === 'new' ? toDraft(undefined, me?.id) : toDraft(current, me?.id)); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }));

  const save = async (state?: Draft['state']) => {
    setSaving(true); setError(null);
    const s = state || d.state;
    const body = {
      name: d.name, kind: d.kind, body: d.body, senderId: d.kind === 'chat' ? d.senderId || null : null,
      link: d.kind === 'banner' && (d.linkLabel || d.linkUrl) ? { label: d.linkLabel, url: d.linkUrl } : null,
      bannerStyle: d.bannerStyle, frequency: d.frequency, state: s,
      audience: { people: d.people, ...(d.pageValue.trim() ? { pageUrl: { op: d.pageOp, value: d.pageValue } } : {}), ...(d.attrKey ? { attribute: { key: d.attrKey, value: d.attrValue } } : {}) },
    };
    try {
      const m = selected === 'new' ? await call('POST', '/outbound', body) : await call('PUT', `/outbound/${selected}`, body);
      await load(); setSelected(m.id); setD(x => ({ ...x, state: m.state }));
      setFlash(m.state === 'live' ? 'Live' : 'Saved'); setTimeout(() => setFlash(null), 2000);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!current || !window.confirm(`Delete “${current.name}”?`)) return;
    try { await call('DELETE', `/outbound/${current.id}`); await load(); setSelected(null); } catch (e: any) { setError(e.message); }
  };

  const sender = agents.find(a => a.id === d.senderId);
  const ro = !isAdmin;

  return (
    <>
      <SettingsPageHeader title="Proactive messages" onBack={onBack}>
        {flash && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> {flash}</span>}
        {isAdmin && <button type="button" onClick={() => setSelected('new')} className="ic-btn-primary"><Plus className="w-4 h-4" /> New message</button>}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 flex">
        <div className="w-80 shrink-0 border-r border-line overflow-y-auto p-2">
          {list.length === 0 && (
            <div className="p-6 text-center">
              <Megaphone className="w-8 h-8 text-muted mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[14px] text-muted">Reach people before they ask: greet visitors on your pricing page, announce a feature, or warn about an outage.</p>
            </div>
          )}
          {list.map(m => (
            <button key={m.id} onClick={() => setSelected(m.id)} className={`w-full text-left px-3 py-2.5 rounded-xl ${selected === m.id ? 'bg-subtle' : 'hover:bg-ink/[0.03]'}`}>
              <span className="flex items-center gap-2">
                {m.kind === 'chat' ? <MessageCircle className="w-4 h-4 text-muted shrink-0" /> : <PanelTop className="w-4 h-4 text-muted shrink-0" />}
                <span className="flex-1 min-w-0 truncate text-[14px] font-medium text-ink">{m.name}</span>
                <span className={`ic-badge h-5 px-1.5 text-[11px] ${m.state === 'live' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted'}`}>{m.state === 'live' ? 'Live' : 'Paused'}</span>
              </span>
              <span className="mt-0.5 block text-[12px] text-faint pl-6">
                Sent {m.stats?.sent || 0} · Opened {m.stats?.opened || 0}{m.kind === 'chat' ? ` · Replied ${m.stats?.replied || 0}` : ` · Dismissed ${m.stats?.dismissed || 0}`}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto">
          {selected === null || (selected !== 'new' && !current) ? (
            <div className="ic-empty h-full"><Megaphone className="w-10 h-10 text-muted mb-2" strokeWidth={1.25} /><p className="text-[14px] text-muted">Select a message, or create one.</p></div>
          ) : (
            <div className="p-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
              <div className="flex flex-col gap-4">
                {error && <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
                <div><label className="ic-label">Name (only teammates see it)</label><input className="ic-input" disabled={ro} value={d.name} maxLength={80} placeholder="Pricing page greeting" onChange={e => set('name', e.target.value)} /></div>
                <div>
                  <label className="ic-label">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([['chat', 'Chat message', 'Pops up from the Messenger launcher; people can reply', MessageCircle], ['banner', 'Banner', 'A bar across the top of the page', PanelTop]] as const).map(([v, label, hint, Icon]) => (
                      <label key={v} className={`flex items-start gap-3 p-3 rounded-xl border ${d.kind === v ? 'border-ink/40 bg-subtle' : 'border-line'} ${ro ? '' : 'cursor-pointer'}`}>
                        <input type="radio" className="mt-1" checked={d.kind === v} disabled={ro} onChange={() => set('kind', v)} />
                        <span><span className="flex items-center gap-1.5 text-[14px] font-medium text-ink"><Icon className="w-4 h-4" />{label}</span><span className="block text-[13px] text-muted">{hint}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="ic-label">Message</label>
                  <textarea className="ic-textarea" rows={d.kind === 'banner' ? 2 : 4} disabled={ro} maxLength={d.kind === 'banner' ? 300 : 2000} value={d.body}
                    placeholder={d.kind === 'banner' ? 'Scheduled maintenance on Sunday 2–4am UTC.' : 'Hi! Looking at plans? Happy to help you pick one.'} onChange={e => set('body', e.target.value)} />
                </div>
                {d.kind === 'chat' ? (
                  <div><label className="ic-label">From</label>
                    <select className="ic-input" disabled={ro} value={d.senderId} onChange={e => set('senderId', e.target.value)}>
                      {agents.filter(a => a.role !== 'light').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3">
                      <div><label className="ic-label">Button label</label><input className="ic-input" disabled={ro} value={d.linkLabel} maxLength={40} placeholder="Learn more" onChange={e => set('linkLabel', e.target.value)} /></div>
                      <div><label className="ic-label">Button link</label><input className="ic-input" disabled={ro} value={d.linkUrl} placeholder="https://…" onChange={e => set('linkUrl', e.target.value)} /></div>
                    </div>
                    <div><label className="ic-label">Style</label>
                      <select className="ic-input w-48" disabled={ro} value={d.bannerStyle} onChange={e => set('bannerStyle', e.target.value as Draft['bannerStyle'])}>
                        <option value="info">Neutral</option><option value="promo">Brand color</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="pt-2 border-t border-line">
                  <p className="ic-section-title mb-3">Audience</p>
                  <div className="flex flex-col gap-3">
                    <div><label className="ic-label">People</label>
                      <select className="ic-input w-64" disabled={ro} value={d.people} onChange={e => set('people', e.target.value as Draft['people'])}>
                        <option value="everyone">Everyone</option><option value="leads">Leads (not logged in, no email)</option><option value="users">Users (logged in or with an email)</option>
                      </select>
                    </div>
                    <div><label className="ic-label">On pages where the URL</label>
                      <div className="flex gap-2">
                        <select className="ic-input w-40" disabled={ro} value={d.pageOp} onChange={e => set('pageOp', e.target.value as Draft['pageOp'])}>
                          <option value="contains">contains</option><option value="starts_with">starts with</option><option value="equals">is</option>
                        </select>
                        <input className="ic-input flex-1" disabled={ro} value={d.pageValue} placeholder="/pricing  (empty = every page)" onChange={e => set('pageValue', e.target.value)} />
                      </div>
                    </div>
                    {attrs.length > 0 && (
                      <div><label className="ic-label">And their attribute</label>
                        <div className="flex gap-2">
                          <select className="ic-input w-48" disabled={ro} value={d.attrKey} onChange={e => set('attrKey', e.target.value)}>
                            <option value="">— any —</option>{attrs.filter(a => !a.archived).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                          </select>
                          {d.attrKey && <input className="ic-input flex-1" disabled={ro} value={d.attrValue} placeholder="is…" onChange={e => set('attrValue', e.target.value)} />}
                        </div>
                      </div>
                    )}
                    <div><label className="ic-label">Show</label>
                      <select className="ic-input w-64" disabled={ro} value={d.frequency} onChange={e => set('frequency', e.target.value as Draft['frequency'])}>
                        <option value="once">Once per person</option><option value="every_page">On every matching page until dismissed</option>
                      </select>
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-2 pt-4 border-t border-line">
                    {d.state === 'live'
                      ? <><button onClick={() => save('live')} disabled={saving} className="ic-btn-primary">{saving ? 'Saving…' : 'Update'}</button><button onClick={() => save('paused')} disabled={saving} className="ic-btn-ghost">Pause</button></>
                      : <><button onClick={() => save('live')} disabled={saving || !d.name.trim() || !d.body.trim()} className="ic-btn-primary disabled:opacity-40">{saving ? 'Saving…' : 'Set live'}</button><button onClick={() => save('paused')} disabled={saving || !d.name.trim() || !d.body.trim()} className="ic-btn-ghost disabled:opacity-40">Save paused</button></>}
                    {current && <button onClick={remove} className="ic-btn-ghost ml-auto text-red-600 dark:text-red-400"><Trash2 className="w-4 h-4" /> Delete</button>}
                  </div>
                )}
              </div>

              {/* Preview */}
              <div>
                <p className="ic-label">Preview</p>
                <div className="rounded-2xl border border-line bg-sidebar overflow-hidden min-h-[260px] relative">
                  {d.kind === 'banner' ? (
                    <div className={`px-4 py-2.5 text-[13px] flex items-center gap-3 ${d.bannerStyle === 'promo' ? 'bg-ink text-on-ink' : 'bg-surface text-ink border-b border-line'}`}>
                      <span className="flex-1 min-w-0">{d.body || 'Your banner text'}</span>
                      {d.linkLabel && <span className="shrink-0 underline font-medium">{d.linkLabel}</span>}
                      <span className="shrink-0 opacity-60">✕</span>
                    </div>
                  ) : (
                    <div className="absolute right-4 bottom-4 flex flex-col items-end gap-3 w-[240px]">
                      <div className="bg-surface rounded-2xl shadow-card border border-line p-3 w-full">
                        <p className="text-[12px] text-muted mb-1">{sender?.name || 'Teammate'}</p>
                        <RichText className="text-[13.5px] text-ink whitespace-pre-wrap" text={d.body || 'Your message'} linkClass="underline" />
                      </div>
                      <span className="w-12 h-12 rounded-full bg-ink" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
