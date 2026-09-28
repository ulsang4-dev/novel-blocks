import type { Novel } from '../model/types';
import { AuthError } from '../storage/auth';
import { DriveError, type DriveApi, type DriveFile } from '../storage/drive';
import type { LocalStore, SyncMeta } from '../storage/local';
import { mergeNovels } from './merge';

export type SyncStatus = 'local-only' | 'saved' | 'syncing' | 'offline' | 'needs-login' | 'conflict' | 'error';

export const MAX_BACKUPS = 10;
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const MAIN = /^novel-(.+)\.json$/;
const BACKUP = /^novel-(.+)\.backup-(\d+)\.json$/;

export const mainName = (id: string) => `novel-${id}.json`;
export const backupName = (id: string, ts: number) => `novel-${id}.backup-${ts}.json`;
const backupTime = (f: DriveFile) => Number(BACKUP.exec(f.name)?.[2] ?? 0);

/** 노드 키 순서와 무관하게 비교하기 위한 정규화 문자열 */
export function canonical(novel: Novel): string {
  const nodes = Object.fromEntries(Object.entries(novel.nodes).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ ...novel, nodes });
}

export function parseNovel(text: string): Novel | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v.id === 'string' && v.nodes && Array.isArray(v.rootIds) ? (v as Novel) : null;
  } catch {
    return null;
  }
}

export interface EngineDeps {
  local: LocalStore;
  drive: DriveApi;
  isSignedIn: () => boolean;
  onStatus: (status: SyncStatus, detail?: string) => void;
  onChanged: (novelIds: string[]) => void;
  now?: () => number;
  debounceMs?: number;
}

export class SyncEngine {
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  constructor(private d: EngineDeps) {}

  schedule(delayMs = this.d.debounceMs ?? 3000): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncAll(), delayMs);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  async syncAll(): Promise<void> {
    if (!this.d.isSignedIn()) {
      this.d.onStatus('local-only');
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.d.onStatus('syncing');
    try {
      const changed = await this.runOnce();
      this.retries = 0;
      if (changed.length) this.d.onChanged(changed);
      const metas = await this.d.local.listMeta();
      this.d.onStatus(metas.some((m) => m.conflicts?.length) ? 'conflict' : 'saved');
    } catch (e) {
      this.handleError(e);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        void this.syncAll();
      }
    }
  }

  private handleError(e: unknown) {
    if (e instanceof AuthError || (e instanceof DriveError && e.status === 401)) {
      this.d.onStatus('needs-login');
      return;
    }
    if (e instanceof DriveError && e.status === 403 && /quota|storage/i.test(e.message)) {
      this.d.onStatus('error', '드라이브 저장 공간이 부족해요. 기기에는 계속 저장돼요.');
      return;
    }
    const offline = e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
    this.d.onStatus(offline ? 'offline' : 'error', e instanceof Error ? e.message : String(e));
    this.retries++;
    this.schedule(Math.min(60_000, 1000 * 2 ** this.retries));
  }

  private async runOnce(): Promise<string[]> {
    const { local, drive } = this.d;
    const changed: string[] = [];
    const mains = new Map<string, DriveFile>();
    const backups = new Map<string, DriveFile[]>();
    for (const f of await drive.listAppFiles()) {
      const b = BACKUP.exec(f.name);
      if (b) backups.set(b[1], [...(backups.get(b[1]) ?? []), f]);
      else {
        const m = MAIN.exec(f.name);
        if (m) mains.set(m[1], f);
      }
    }
    const metas = new Map((await local.listMeta()).map((m) => [m.novelId, m]));

    // 1) 이 기기에서 지운 작품 → 드라이브에서도 지운다
    for (const meta of metas.values()) {
      if (!meta.deleted) continue;
      for (const f of [mains.get(meta.novelId), ...(backups.get(meta.novelId) ?? [])]) {
        if (f) await drive.deleteFile(f.id);
      }
      mains.delete(meta.novelId);
      metas.delete(meta.novelId);
      await local.deleteMeta(meta.novelId);
    }

    // 2) 이 기기에 있는 작품
    for (const novel of await local.listNovels()) {
      const file = mains.get(novel.id);
      mains.delete(novel.id);
      if (await this.syncOne(novel, metas.get(novel.id), file, backups.get(novel.id) ?? [])) changed.push(novel.id);
    }

    // 3) 드라이브에만 있는 작품 → 내려받는다
    for (const [id, file] of mains) {
      const remote = await this.readRemote(file, backups.get(id) ?? []);
      if (!remote) continue;
      await local.putNovel(remote);
      await local.putBase(remote);
      await local.putMeta({ novelId: id, driveFileId: file.id, remoteModified: file.modifiedTime, syncedAt: remote.updatedAt });
      changed.push(id);
    }
    return changed;
  }

  private async readRemote(file: DriveFile, backups: DriveFile[]): Promise<Novel | null> {
    const main = parseNovel(await this.d.drive.download(file.id));
    if (main) return main;
    for (const b of [...backups].sort((x, y) => backupTime(y) - backupTime(x))) {
      const restored = parseNovel(await this.d.drive.download(b.id));
      if (restored) return restored;
    }
    return null;
  }

  /** 작품 하나를 동기화한다. 기기의 작품 내용이 바뀌었으면 true. */
  private async syncOne(novel: Novel, meta: SyncMeta | undefined, file: DriveFile | undefined, backups: DriveFile[]): Promise<boolean> {
    const { local, drive } = this.d;
    const dirty = meta?.syncedAt !== novel.updatedAt;

    if (!file) {
      if (meta?.driveFileId && !dirty) {
        // 다른 기기에서 삭제했고 이 기기에서 고친 것도 없음
        await local.deleteNovel(novel.id);
        await local.deleteMeta(novel.id);
        return true;
      }
      const created = await drive.createAppFile(mainName(novel.id), JSON.stringify(novel));
      await local.putBase(novel);
      await local.putMeta({ novelId: novel.id, driveFileId: created.id, remoteModified: created.modifiedTime, syncedAt: novel.updatedAt });
      return false;
    }

    if (meta?.conflicts?.length) return false; // 사용자가 충돌을 해결할 때까지 보류

    if (meta?.remoteModified === file.modifiedTime) {
      if (dirty) await this.upload(novel, file, await local.getBase(novel.id), backups);
      return false;
    }

    const remote = parseNovel(await drive.download(file.id));
    if (!remote) {
      // 원격 파일 손상 → 이 기기 내용으로 덮어쓴다
      await this.upload(novel, file, undefined, backups);
      return false;
    }

    const { merged, conflicts } = mergeNovels(await local.getBase(novel.id), novel, remote);
    const unchangedLocally = canonical(merged) === canonical(novel);
    if (!unchangedLocally && !(await local.casNovel(merged, novel.updatedAt))) {
      this.again = true; // 병합 중 사용자가 입력함 → 다음 회차에 다시
      return false;
    }
    await local.putBase(remote);
    const next: SyncMeta = { novelId: novel.id, driveFileId: file.id, remoteModified: file.modifiedTime, syncedAt: meta?.syncedAt };

    if (conflicts.length) {
      await local.putMeta({ ...next, conflicts });
    } else if (canonical(merged) === canonical(remote)) {
      await local.putMeta({ ...next, syncedAt: merged.updatedAt });
    } else {
      await local.putMeta(next);
      await this.upload(merged, file, remote, backups);
    }
    return !unchangedLocally;
  }

  private async upload(novel: Novel, file: DriveFile, previous: Novel | undefined, backups: DriveFile[]) {
    const { local, drive } = this.d;
    const now = (this.d.now ?? Date.now)();
    const sorted = [...backups].sort((a, b) => backupTime(b) - backupTime(a));
    if (previous && (sorted.length === 0 || now - backupTime(sorted[0]) >= BACKUP_INTERVAL_MS)) {
      await drive.createAppFile(backupName(novel.id, now), JSON.stringify(previous));
      for (const old of sorted.slice(MAX_BACKUPS - 1)) await drive.deleteFile(old.id);
    }
    const updated = await drive.updateFile(file.id, JSON.stringify(novel));
    await local.putBase(novel);
    await local.putMeta({ novelId: novel.id, driveFileId: file.id, remoteModified: updated.modifiedTime, syncedAt: novel.updatedAt });
  }
}
