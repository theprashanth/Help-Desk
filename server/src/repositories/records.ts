import crypto from 'crypto';
import mongoose, { Schema } from 'mongoose';
import { RepositoryFactory } from './factory';
import { readJson, writeJson, transaction } from './json.repo';
import { getActiveWorkspaceId } from '../context/tenant.context';

/**
 * Small per-workspace record store for simple documents (teams, companies, audit log entries).
 * JSON: one file per collection (`<collection>.json`). MongoDB: one `records` collection holding
 * `{ workspaceId, collection, id, data }`. Records are plain objects with an `id`.
 */
export type StoredRecord = { id: string; workspaceId?: string; createdAt?: string; updatedAt?: string };

interface IRecordDoc { workspaceId: string; collectionName: string; recordId: string; data: any; createdAt?: Date }
const RecordSchema = new Schema<IRecordDoc>({
  workspaceId: { type: String, required: true, index: true },
  collectionName: { type: String, required: true, index: true },
  recordId: { type: String, required: true },
  data: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });
RecordSchema.index({ workspaceId: 1, collectionName: 1, recordId: 1 }, { unique: true });
const RecordModel = (mongoose.models.Record as mongoose.Model<IRecordDoc>) || mongoose.model<IRecordDoc>('Record', RecordSchema);

export class RecordRepository<T extends StoredRecord> {
  constructor(private collection: string, private idPrefix: string) {}

  private get file() { return `${this.collection}.json`; }
  private newId() { return `${this.idPrefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`; }

  async list(): Promise<T[]> {
    const ws = getActiveWorkspaceId();
    if (RepositoryFactory.isJson()) {
      return (await readJson<T[]>(this.file, [])).filter(r => r.workspaceId === ws);
    }
    const docs = await RecordModel.find({ workspaceId: ws, collectionName: this.collection }).sort({ createdAt: 1 }).lean();
    return docs.map(d => d.data as T);
  }

  async get(id: string): Promise<T | null> {
    return (await this.list()).find(r => r.id === id) || null;
  }

  async create(data: Omit<T, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>): Promise<T> {
    const now = new Date().toISOString();
    const rec = { ...(data as object), id: this.newId(), workspaceId: getActiveWorkspaceId(), createdAt: now, updatedAt: now } as T;
    if (RepositoryFactory.isJson()) {
      return transaction(async () => {
        const all = await readJson<T[]>(this.file, []);
        all.push(rec);
        await writeJson(this.file, all);
        return rec;
      });
    }
    await RecordModel.create({ workspaceId: rec.workspaceId, collectionName: this.collection, recordId: rec.id, data: rec });
    return rec;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const ws = getActiveWorkspaceId();
    if (RepositoryFactory.isJson()) {
      return transaction(async () => {
        const all = await readJson<T[]>(this.file, []);
        const i = all.findIndex(r => r.id === id && r.workspaceId === ws);
        if (i === -1) return null;
        all[i] = { ...all[i], ...patch, id, workspaceId: ws, updatedAt: new Date().toISOString() };
        // undefined fields are dropped on save, so they can be cleared
        await writeJson(this.file, all);
        return all[i];
      });
    }
    const doc = await RecordModel.findOne({ workspaceId: ws, collectionName: this.collection, recordId: id });
    if (!doc) return null;
    const next = { ...doc.data, ...patch, id, workspaceId: ws, updatedAt: new Date().toISOString() };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    doc.data = next;
    doc.markModified('data');
    await doc.save();
    return next as T;
  }

  async delete(id: string): Promise<boolean> {
    const ws = getActiveWorkspaceId();
    if (RepositoryFactory.isJson()) {
      return transaction(async () => {
        const all = await readJson<T[]>(this.file, []);
        const rest = all.filter(r => !(r.id === id && r.workspaceId === ws));
        if (rest.length === all.length) return false;
        await writeJson(this.file, rest);
        return true;
      });
    }
    const r = await RecordModel.deleteOne({ workspaceId: ws, collectionName: this.collection, recordId: id });
    return r.deletedCount > 0;
  }

  /** Append-only collections (audit log): keep only the newest `max` records per workspace. */
  async prune(max: number): Promise<void> {
    const ws = getActiveWorkspaceId();
    if (RepositoryFactory.isJson()) {
      await transaction(async () => {
        const all = await readJson<T[]>(this.file, []);
        const mine = all.filter(r => r.workspaceId === ws);
        if (mine.length <= max) return;
        const drop = new Set(mine.slice(0, mine.length - max).map(r => r.id));
        await writeJson(this.file, all.filter(r => !(r.workspaceId === ws && drop.has(r.id))));
      });
      return;
    }
    const extra = await RecordModel.find({ workspaceId: ws, collectionName: this.collection })
      .sort({ createdAt: -1 }).skip(max).select('_id').lean();
    if (extra.length) await RecordModel.deleteMany({ _id: { $in: extra.map(e => e._id) } });
  }
}
