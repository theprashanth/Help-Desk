import crypto from 'crypto';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { DataImportRecord, DataImportType } from '../../../shared/src/types';
import { parseCsvObjects } from '../services/csv';
import { FIELDS, Mapping, checkMapping, runImport, suggestMapping } from '../services/dataImport';
import { ExportType, buildExport } from '../services/dataExport';
import { logAudit } from '../services/audit';

const TYPES: DataImportType[] = ['people', 'conversations', 'messages'];
const MAX_ROWS = 100_000;
const wsIdOf = (req: AuthenticatedRequest) => req.workspaceId || req.user?.workspaceId || 'default_workspace';

function admin(req: AuthenticatedRequest, res: Response) {
  if (!req.user) { res.status(401).json({ error: 'Unauthenticated' }); return false; }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Only admins can import or export data' }); return false; }
  return true;
}

function readUpload(req: AuthenticatedRequest, res: Response) {
  const type = req.query.type as DataImportType;
  if (!TYPES.includes(type)) { res.status(400).json({ error: 'type must be people, conversations or messages' }); return null; }
  const text = typeof req.body === 'string' ? req.body : '';
  if (!text.trim()) { res.status(400).json({ error: 'The file is empty' }); return null; }
  const { headers, rows } = parseCsvObjects(text);
  if (!headers.length) { res.status(400).json({ error: 'No header row found. The first line must list the column names.' }); return null; }
  if (!rows.length) { res.status(400).json({ error: 'The file has a header row but no data rows' }); return null; }
  if (rows.length > MAX_ROWS) { res.status(400).json({ error: `At most ${MAX_ROWS.toLocaleString()} rows per file; split it into smaller files` }); return null; }
  return { type, headers, rows };
}

/** POST /api/data/imports/preview?type= (body: the CSV text) — columns, suggested mapping and sample rows. */
export async function previewImport(req: AuthenticatedRequest, res: Response) {
  if (!admin(req, res)) return;
  const up = readUpload(req, res);
  if (!up) return;
  return res.json({
    type: up.type,
    headers: up.headers,
    rowCount: up.rows.length,
    sample: up.rows.slice(0, 5),
    mapping: suggestMapping(up.type, up.headers),
    fields: FIELDS[up.type],
  });
}

/** POST /api/data/imports?type=&fileName=&mapping= (body: the CSV text) — run the import. */
export async function runDataImport(req: AuthenticatedRequest, res: Response) {
  if (!admin(req, res)) return;
  const up = readUpload(req, res);
  if (!up) return;
  let mapping: Mapping;
  try { mapping = JSON.parse(String(req.query.mapping || '{}')); } catch { return res.status(400).json({ error: 'Invalid column mapping' }); }
  // Only known fields, only headers that exist in the file
  const clean: Mapping = {};
  for (const f of FIELDS[up.type]) {
    const h = mapping[f.key];
    clean[f.key] = typeof h === 'string' && up.headers.includes(h) ? h : null;
  }
  const problem = checkMapping(up.type, clean);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const result = await runImport(up.type, up.rows, clean);
    const me = req.user ? await RepositoryFactory.getUserRepository().findById(req.user.id) : null;
    const record: DataImportRecord = {
      id: crypto.randomBytes(6).toString('hex'),
      type: up.type,
      fileName: String(req.query.fileName || 'import.csv').slice(0, 200),
      at: new Date().toISOString(),
      byName: me?.name || req.user?.email,
      rows: result.rows, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length,
    };
    const repo = RepositoryFactory.getWorkspaceRepository();
    const ws = await repo.findById(wsIdOf(req));
    if (ws) await repo.update(ws.id, { dataImports: [record, ...(ws.dataImports || [])].slice(0, 50) });
    await logAudit(req, 'data.imported', `Imported ${record.rows} ${up.type} rows from ${record.fileName}`, { details: { created: record.created, updated: record.updated, skipped: record.skipped } });
    return res.json({ ...result, record });
  } catch (e: any) {
    console.error('[Import] failed:', e);
    return res.status(500).json({ error: `The import failed: ${e.message}` });
  }
}

/** GET /api/data/imports — past imports (newest first). */
export async function listImports(req: AuthenticatedRequest, res: Response) {
  if (!admin(req, res)) return;
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
  return res.json(ws?.dataImports || []);
}

/** GET /api/data/exports/:type?from=&to= — CSV download (people, conversations, messages). */
export async function downloadExport(req: AuthenticatedRequest, res: Response) {
  if (!admin(req, res)) return;
  const type = req.params.type as ExportType;
  if (!['people', 'conversations', 'messages'].includes(type)) return res.status(400).json({ error: 'Unknown export' });
  const day = (v: unknown, end = false) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    return new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}Z`).toISOString();
  };
  const { csv, rows } = await buildExport(type, day(req.query.from), day(req.query.to, true));
  await logAudit(req, 'data.exported', `Exported ${rows} ${type} rows`, { details: { type, from: req.query.from || null, to: req.query.to || null } });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-${stamp}.csv"`);
  res.setHeader('X-Row-Count', String(rows));
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Row-Count');
  return res.send(csv);
}
