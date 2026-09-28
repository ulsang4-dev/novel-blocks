import { create } from 'zustand';
import { exportNovel as exportToDrive } from '../export/exportToDrive';
import { setNovelFields, TreeError } from '../model/ops';
import { createNovel } from '../model/templates';
import type { Novel } from '../model/types';
import { LocalStore } from '../storage/local';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import { resolveConflict, type Conflict, type Resolution } from '../sync/merge';
import { preferNewer } from './preferNewer';
import { auth, drive } from './services';

interface AppState {
  ready: boolean;
  novels: Record<string, Novel>;
  status: SyncStatus;
  statusDetail?: string;
  signedIn: boolean;
  conflicts: Record<string, Conflict[]>;
  init: () => Promise<void>;
  reload: () => Promise<void>;
  create: (title: string, templateId: string) => Promise<string>;
  remove: (id: string) => Promise<void>;
  update: (id: string, fn: (n: Novel) => Novel) => void;
  resolve: (novelId: string, conflict: Conflict, choice: Resolution) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => void;
  exportNovel: (id: string, withOutline: boolean) => Promise<string>;
}

let local: LocalStore;
let engine: SyncEngine;
let initPromise: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

// 로컬 저장을 순서대로 처리한다(빠른 연속 입력에서도 마지막 내용이 마지막에 저장되도록)
function queueWrite(job: () => Promise<void>): Promise<void> {
  writes = writes.then(job).catch((e) => console.error('기기 저장 실패', e));
  return writes;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  novels: {},
  status: 'local-only',
  signedIn: false,
  conflicts: {},

  init() {
    initPromise ??= (async () => {
      local = await LocalStore.open();
      engine = new SyncEngine({
        local,
        drive,
        isSignedIn: () => auth?.isSignedIn() ?? false,
        onStatus: (status, statusDetail) => set({ status, statusDetail }),
        onChanged: () => void get().reload(),
      });
      await get().reload();
      set({ ready: true });
      const kick = () => void engine.syncAll();
      window.addEventListener('focus', kick);
      window.addEventListener('online', kick);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') kick();
      });
      auth?.onChange((signedIn) => set({ signedIn }));
      if (auth?.wasSignedIn()) {
        try {
          await auth.trySilent();
          kick();
        } catch {
          set({ status: 'needs-login' });
        }
      }
    })();
    return initPromise;
  },

  async reload() {
    await writes;
    const [list, metas] = await Promise.all([local.listNovels(), local.listMeta()]);
    set((s) => ({
      novels: preferNewer(s.novels, list),
      conflicts: Object.fromEntries(metas.filter((m) => m.conflicts?.length).map((m) => [m.novelId, m.conflicts!])),
    }));
  },

  async create(title, templateId) {
    const novel = createNovel(title, templateId);
    set((s) => ({ novels: { ...s.novels, [novel.id]: novel } }));
    await queueWrite(() => local.putNovel(novel));
    engine.schedule();
    return novel.id;
  },

  async remove(id) {
    set((s) => {
      const novels = { ...s.novels };
      delete novels[id];
      return { novels };
    });
    await queueWrite(() => local.tombstone(id));
    engine.schedule();
  },

  update(id, fn) {
    const current = get().novels[id];
    if (!current) return;
    let next: Novel;
    try {
      next = fn(current);
    } catch (e) {
      if (e instanceof TreeError) {
        alert(e.message);
        return;
      }
      throw e;
    }
    if (next === current) return;
    set((s) => ({ novels: { ...s.novels, [id]: next } }));
    void queueWrite(() => local.putNovel(next));
    engine.schedule();
  },

  async resolve(novelId, conflict, choice) {
    const current = get().novels[novelId];
    if (!current) return;
    const next = resolveConflict(current, conflict, choice);
    const remaining = (get().conflicts[novelId] ?? []).filter((c) => c.nodeId !== conflict.nodeId);
    set((s) => ({ novels: { ...s.novels, [novelId]: next }, conflicts: { ...s.conflicts, [novelId]: remaining } }));
    await queueWrite(async () => {
      await local.putNovel(next);
      const meta = await local.getMeta(novelId);
      if (meta) await local.putMeta({ ...meta, conflicts: remaining });
    });
    if (remaining.length === 0) void engine.syncAll();
  },

  async signIn() {
    if (!auth) throw new Error('구글 연동이 설정되지 않았어요 (docs/setup-google.md 참고)');
    await auth.signIn();
    await engine.syncAll();
  },

  signOut() {
    auth?.signOut();
    set({ status: 'local-only' });
  },

  async exportNovel(id, withOutline) {
    const current = get().novels[id];
    if (!current) throw new Error('작품을 찾을 수 없어요');
    const ids = await exportToDrive(current, drive, { outline: withOutline });
    get().update(id, (n) => setNovelFields(n, ids));
    return ids.exportDocId;
  },
}));
