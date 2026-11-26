import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * GIF search for the reply box (⋯ › GIFs), through GIPHY. Set GIPHY_API_KEY on the server
 * (free at developers.giphy.com); without it the picker still lets a teammate paste a GIF link.
 */
type Gif = { id: string; title: string; preview: string; url: string; width: number; height: number };

const cache = new Map<string, { at: number; gifs: Gif[] }>();

/** GET /api/gifs?q=thanks — trending when q is empty. */
export async function searchGifs(req: AuthenticatedRequest, res: Response) {
  const key = process.env.GIPHY_API_KEY || '';
  if (!key) return res.json({ enabled: false, gifs: [] });
  const q = String(req.query.q || '').trim().slice(0, 100);
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < 10 * 60_000) return res.json({ enabled: true, gifs: hit.gifs });
  const params = new URLSearchParams({ api_key: key, limit: '24', rating: 'g' });
  if (q) params.set('q', q);
  try {
    const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: `GIPHY answered ${r.status}. Check GIPHY_API_KEY.` });
    const data: any = await r.json();
    const gifs: Gif[] = (data?.data || []).map((g: any) => {
      const full = g.images?.downsized || g.images?.original || {};
      const small = g.images?.fixed_width || full;
      return { id: String(g.id), title: String(g.title || 'GIF'), preview: small.url, url: full.url, width: Number(full.width) || 0, height: Number(full.height) || 0 };
    }).filter((g: Gif) => g.url && g.preview);
    cache.set(q, { at: Date.now(), gifs });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return res.json({ enabled: true, gifs });
  } catch (e: any) {
    return res.status(502).json({ error: `Couldn't reach GIPHY: ${e.message}` });
  }
}
