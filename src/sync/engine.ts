import type { Novel } from '../model/types';
import { AuthError } from '../storage/auth';
import { DriveError, type DriveApi, type DriveFile } from '../storage/drive';
import type { LocalStore, SyncMeta } from '../storage/local';
import { mergeNovels } from './merge';

export type SyncStatus = 'local-only' | 'saved' | 'syncing' | 'offline' | 'needs-login' | 'conflict' | 'error';
/** signed-out: 로그인한 적 없음 · active: 토큰 유효 · expired: 로그인했지만 토큰 만료 */
export type AuthState = 'signed-out' | 'active' | 'expired';

export const MAX_BACKUPS = 10;
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const MAIN = /^novel-(.+)\.json$/;
const BACKUP = /^novel-(.+)\.backup-(\d+)\.json$/;
const DELETED = /^novel-(.+)\.deleted$/;

export const mainName = (id: string) => `novel-${id}.json`;
/** 삭제 표시 파일. 파일이 "없다"는 것만으로는 삭제로 보지 않는다(계정 전환·앱 데이터 삭제 대비). */
export const deletedName = (id: string) => `novel-${id}.deleted`;
export const backupName = (id: string, ts: number) => `novel-${id}.backup-${ts}.json`;
const backupTime = (f: DriveFile) => Number(BACKUP.exec(f.name)?.[2] ?? 0);

/** 내용 비교용 정규화 문자열. 노드 키 순서와 작품 수정 시각은 무시한다. */
export function canonical(novel: Novel): string {
  const { updatedAt: _updatedAt, ...rest } = novel;
  const nodes = Object.fromEntries(Object.entries(novel.nodes).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ ...rest, nodes });
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
  auth: () => AuthState;
  /** 만료된 토큰을 조용히 다시 받는다. 실패하면 reject. */
  reauth?: () => Promise<void>;
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
    if (this.d.auth() === 'signed-out') {
      this.d.onStatus('local-only');
      return;
    }
    if (this.d.auth() === 'expired') {
      try {
        await this.d.reauth?.();
      } catch {
        // 아래에서 로그인 필요로 처리
      }
      if (this.d.auth() !== 'active') {
        this.d.onStatus('needs-login');
        return;
      }
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.d.onStatus('syncing');
    try {
      const changed: string[] = [];
      let rounds = 0;
      do {
        this.again = false;
        changed.push(...(await this.runOnce()));
      } while (this.again && ++rounds < 3);
      // 계속 입력 중이라 병합이 밀리면 잠시 뒤에 다시 (드라이브를 쉬지 않고 두드리지 않게)
      if (this.again) this.schedule(1000);
      this.retries = 0;
      if (changed.length) this.d.onChanged([...new Set(changed)]);
      const metas = await this.d.local.listMeta();
      this.d.onStatus(metas.some((m) => m.conflicts?.length) ? 'conflict' : 'saved');
    } catch (e) {
      this.handleError(e);
    } finally {
      this.running = false;
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
    const markers = new Map<string, DriveFile>();
    for (const f of await drive.listAppFiles()) {
      const b = BACKUP.exec(f.name);
      const d = DELETED.exec(f.name);
      if (b) backups.set(b[1], [...(backups.get(b[1]) ?? []), f]);
      else if (d) markers.set(d[1], f);
      else {
        const m = MAIN.exec(f.name);
        if (m) mains.set(m[1], f);
      }
    }
    const metas = new Map((await local.listMeta()).map((m) => [m.novelId, m]));

    // 1) 이 기기에서 지운 작품 → 드라이브에서도 지우고 삭제 표시를 남긴다
    for (const meta of metas.values()) {
      if (!meta.deleted) continue;
      const main = mains.get(meta.novelId);
      metas.delete(meta.novelId);
      await local.deleteMeta(meta.novelId);
      if (main && main.modifiedTime !== meta.remoteModified) {
        // 이 기기가 모르는 수정이 그 뒤에 올라왔다 → 삭제를 취소하고 3)에서 다시 내려받는다
        continue;
      }
      for (const f of [main, ...(backups.get(meta.novelId) ?? [])]) {
        if (f) await drive.deleteFile(f.id);
      }
      mains.delete(meta.novelId);
      if (!markers.has(meta.novelId)) markers.set(meta.novelId, await drive.createAppFile(deletedName(meta.novelId), ''));
    }

    // 2) 이 기기에 있는 작품
    for (const novel of await local.listNovels()) {
      const file = mains.get(novel.id);
      mains.delete(novel.id);
      if (await this.syncOne(novel, metas.get(novel.id), file, backups.get(novel.id) ?? [], markers.get(novel.id))) {
        changed.push(novel.id);
      }
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
  private async syncOne(
    novel: Novel,
    meta: SyncMeta | undefined,
    file: DriveFile | undefined,
    backups: DriveFile[],
    marker: DriveFile | undefined,
  ): Promise<boolean> {
    const { local, drive } = this.d;
    const dirty = meta?.syncedAt !== novel.updatedAt;

    if (!file) {
      if (marker && meta?.driveFileId && !dirty) {
        // 다른 기기에서 삭제했고 이 기기에서 고친 것도 없음 (방금 입력한 글이 있으면 지우지 않는다)
        if (!(await local.deleteNovelIf(novel.id, novel.updatedAt))) {
          this.again = true;
          return false;
        }
        await local.deleteMeta(novel.id);
        return true;
      }
      // 파일이 없음: 새 작품, 삭제 뒤 이 기기에서 고친 작품, 또는 다른 계정/지워진 앱 데이터 → 올린다
      const created = await drive.createAppFile(mainName(novel.id), JSON.stringify(novel));
      if (marker) await drive.deleteFile(marker.id);
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
    // 병합으로 바뀐 사본은 수정 시각을 반드시 올린다 → 화면의 편집이 병합을 알아채고 그 위에 다시 얹는다
    const saved = unchangedLocally ? novel : { ...merged, updatedAt: Math.max(merged.updatedAt, novel.updatedAt + 1) };
    if (!unchangedLocally) {
      if (!(await local.casNovel(saved, novel.updatedAt))) {
        this.again = true; // 병합 중 사용자가 입력함 → 다음 회차에 다시
        return false;
      }
      this.d.onChanged([novel.id]); // 화면을 곧바로 병합본으로 갱신
    }
    await local.putBase(remote);
    const next: SyncMeta = { novelId: novel.id, driveFileId: file.id, remoteModified: file.modifiedTime, syncedAt: meta?.syncedAt };

    if (conflicts.length) {
      await local.putMeta({ ...next, conflicts });
    } else if (canonical(saved) === canonical(remote)) {
      await local.putMeta({ ...next, syncedAt: saved.updatedAt });
    } else {
      await local.putMeta(next);
      await this.upload(saved, file, remote, backups);
    }
    return !unchangedLocally;
  }

  private async upload(novel: Novel, file: DriveFile, previous: Novel | undefined, backups: DriveFile[]) {
    const { local, drive } = this.d;
    // 목록을 읽은 뒤 다른 기기가 먼저 올렸다면 덮어쓰지 않고 다음 회차에 병합한다
    if ((await drive.getFile(file.id)).modifiedTime !== file.modifiedTime) {
      this.again = true;
      return;
    }
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
