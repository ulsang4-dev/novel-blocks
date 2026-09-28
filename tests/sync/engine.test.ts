import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { addNode, updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import type { Novel } from '../../src/model/types';
import { AuthError } from '../../src/storage/auth';
import { DriveError, type DriveApi, type DriveFile } from '../../src/storage/drive';
import { LocalStore } from '../../src/storage/local';
import {
  BACKUP_INTERVAL_MS, deletedName, mainName, MAX_BACKUPS, SyncEngine, type AuthState, type SyncStatus,
} from '../../src/sync/engine';
import { resolveConflict } from '../../src/sync/merge';
import { FakeDrive } from '../fakeDrive';

let seq = 0;
const engines: SyncEngine[] = [];
afterEach(() => engines.splice(0).forEach((e) => e.dispose()));

async function device(
  drive: DriveApi,
  clock = { t: Date.now() },
  authState: AuthState | (() => AuthState) = 'active',
  reauth?: () => Promise<void>,
) {
  const local = await LocalStore.open(`engine-test-${++seq}`);
  const statuses: SyncStatus[] = [];
  const engine = new SyncEngine({
    local, drive, auth: typeof authState === 'function' ? authState : () => authState, reauth,
    onStatus: (s) => statuses.push(s), onChanged: () => {}, now: () => clock.t,
  });
  engines.push(engine);
  return { local, engine, last: () => statuses[statuses.length - 1] };
}

async function edit(local: LocalStore, id: string, fn: (n: Novel) => Novel) {
  await local.putNovel(fn((await local.getNovel(id))!));
}

async function seeded(drive: FakeDrive) {
  const a = await device(drive);
  const b = await device(drive);
  let novel = createNovel('동기화', 'blank');
  const s1 = addNode(novel, { parentId: novel.rootIds[0], kind: 'scene', title: '씬1' }); novel = s1.novel;
  const s2 = addNode(novel, { parentId: novel.rootIds[0], kind: 'scene', title: '씬2' }); novel = s2.novel;
  await a.local.putNovel(novel);
  await a.engine.syncAll();
  await b.engine.syncAll();
  return { a, b, id: novel.id, s1: s1.id, s2: s2.id };
}

const remoteNovel = async (drive: FakeDrive, id: string): Promise<Novel> => {
  const file = (await drive.listAppFiles()).find((f) => f.name === mainName(id))!;
  return JSON.parse(await drive.download(file.id));
};

describe('SyncEngine', () => {
  it('로그인 전에는 기기에만 저장 상태', async () => {
    const d = await device(new FakeDrive(), { t: 0 }, 'signed-out');
    await d.engine.syncAll();
    expect(d.last()).toBe('local-only');
  });

  it('새 작품을 올리고 다른 기기가 내려받는다', async () => {
    const drive = new FakeDrive();
    const { a, b, id } = await seeded(drive);
    expect(drive.appFileNames()).toEqual([mainName(id)]);
    expect(await b.local.getNovel(id)).toEqual(await a.local.getNovel(id));
    expect(a.last()).toBe('saved');
  });

  it('두 기기에서 서로 다른 씬을 고치면 둘 다 반영된다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1, s2 } = await seeded(drive);
    await edit(a.local, id, (n) => updateNode(n, s1, { plot: 'A가 씀' }));
    await edit(b.local, id, (n) => updateNode(n, s2, { plot: 'B가 씀' }));
    await a.engine.syncAll();
    await b.engine.syncAll();
    await a.engine.syncAll();
    for (const d of [a, b]) {
      const n = (await d.local.getNovel(id))!;
      expect(n.nodes[s1].plot).toBe('A가 씀');
      expect(n.nodes[s2].plot).toBe('B가 씀');
    }
  });

  it('같은 씬 충돌은 해결 전까지 올리지 않고, 해결하면 올린다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1 } = await seeded(drive);
    await edit(a.local, id, (n) => updateNode(n, s1, { body: '<p>A</p>' }));
    await edit(b.local, id, (n) => updateNode(n, s1, { body: '<p>B</p>' }));
    await a.engine.syncAll();
    await b.engine.syncAll();
    expect(b.last()).toBe('conflict');
    const meta = (await b.local.getMeta(id))!;
    expect(meta.conflicts).toHaveLength(1);
    expect((await remoteNovel(drive, id)).nodes[s1].body).toBe('<p>A</p>');

    const resolved = resolveConflict((await b.local.getNovel(id))!, meta.conflicts![0], 'both');
    await b.local.putNovel(resolved);
    await b.local.putMeta({ ...meta, conflicts: [] });
    await b.engine.syncAll();
    await a.engine.syncAll();
    const bodies = Object.values((await a.local.getNovel(id))!.nodes).map((x) => x.body);
    expect(bodies).toContain('<p>A</p>');
    expect(bodies).toContain('<p>B</p>');
  });

  it('한 기기에서 삭제하면 다른 기기에서도 사라진다', async () => {
    const drive = new FakeDrive();
    const { a, b, id } = await seeded(drive);
    await a.local.tombstone(id);
    await a.engine.syncAll();
    expect(drive.appFileNames()).toEqual([deletedName(id)]); // 삭제는 표시 파일로 남긴다
    await b.engine.syncAll();
    expect(await b.local.getNovel(id)).toBeUndefined();
  });

  it('삭제된 작품을 다른 기기에서 고쳤다면 되살린다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1 } = await seeded(drive);
    await a.local.tombstone(id);
    await a.engine.syncAll();
    await edit(b.local, id, (n) => updateNode(n, s1, { body: '<p>지키기</p>' }));
    await b.engine.syncAll();
    expect(drive.appFileNames()).toEqual([mainName(id)]);
    expect((await remoteNovel(drive, id)).nodes[s1].body).toBe('<p>지키기</p>');
  });

  it('원격 파일이 손상되면 기기 내용으로 복구한다', async () => {
    const drive = new FakeDrive();
    const { a, id, s1 } = await seeded(drive);
    const file = (await drive.listAppFiles()).find((f) => f.name === mainName(id))!;
    await drive.updateFile(file.id, '{깨진');
    await edit(a.local, id, (n) => updateNode(n, s1, { plot: '복구' }));
    await a.engine.syncAll();
    expect((await remoteNovel(drive, id)).nodes[s1].plot).toBe('복구');
  });

  it('백업은 10분 간격으로 만들고 최대 10개만 남긴다', async () => {
    const drive = new FakeDrive();
    const clock = { t: 1_000_000 };
    const a = await device(drive, clock);
    const novel = createNovel('백업', 'blank');
    await a.local.putNovel(novel);
    await a.engine.syncAll();
    const block = novel.rootIds[0];
    const backups = () => drive.appFileNames().filter((n) => n.includes('.backup-'));

    await edit(a.local, novel.id, (n) => updateNode(n, block, { plot: 'x1' }));
    await a.engine.syncAll();
    await edit(a.local, novel.id, (n) => updateNode(n, block, { plot: 'x2' }));
    await a.engine.syncAll();
    expect(backups()).toHaveLength(1); // 10분 안의 연속 수정은 백업 1개

    for (let i = 0; i < 12; i++) {
      clock.t += BACKUP_INTERVAL_MS;
      await edit(a.local, novel.id, (n) => updateNode(n, block, { plot: `v${i}` }));
      await a.engine.syncAll();
    }
    expect(backups()).toHaveLength(MAX_BACKUPS);
  });

  it('토큰 만료(401 또는 AuthError)는 로그인 필요 상태', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    drive.failWith = new DriveError(401, 'Invalid Credentials');
    await a.engine.syncAll();
    expect(a.last()).toBe('needs-login');
    drive.failWith = new AuthError('로그인이 만료됐어요');
    await a.engine.syncAll();
    expect(a.last()).toBe('needs-login');
  });

  it('네트워크 오류는 오프라인 상태', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    drive.failWith = new TypeError('Failed to fetch');
    await a.engine.syncAll();
    expect(a.last()).toBe('offline');
  });
});

describe('SyncEngine — 글 유실 회귀 테스트', () => {
  it('병합으로 기기 사본이 바뀌면 수정 시각이 이전보다 커진다(화면 편집이 병합을 알아챌 수 있게)', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1, s2 } = await seeded(drive);
    await edit(b.local, id, (n) => updateNode(n, s2, { plot: 'B' }));
    await b.engine.syncAll();
    await edit(a.local, id, (n) => updateNode(n, s1, { plot: 'A가 나중에 씀' })); // 로컬이 원격보다 최신
    const before = (await a.local.getNovel(id))!.updatedAt;
    await a.engine.syncAll();
    const after = (await a.local.getNovel(id))!;
    expect(after.nodes[s2].plot).toBe('B');
    expect(after.updatedAt).toBeGreaterThan(before);
  });

  it('오래된 사본에서 삭제해도 다른 기기가 그 뒤에 고친 내용은 지우지 않는다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1 } = await seeded(drive);
    await edit(b.local, id, (n) => updateNode(n, s1, { body: '<p>B의 새 글</p>' }));
    await b.engine.syncAll();
    await a.local.tombstone(id); // A는 B의 수정을 받기 전에 삭제
    await a.engine.syncAll();
    expect(drive.appFileNames()).toContain(mainName(id));
    expect((await remoteNovel(drive, id)).nodes[s1].body).toBe('<p>B의 새 글</p>');
    await b.engine.syncAll();
    expect(await b.local.getNovel(id)).toBeDefined();
  });

  it('다른 계정(빈 드라이브)으로 바꿔도 기기의 작품을 지우지 않고 올린다', async () => {
    const { a, id } = await seeded(new FakeDrive());
    // 같은 기기 저장소를 새 계정의 빈 드라이브와 동기화
    const otherAccount = new FakeDrive();
    const engine = new SyncEngine({ local: a.local, drive: otherAccount, auth: () => 'active', onStatus: () => {}, onChanged: () => {} });
    engines.push(engine);
    await engine.syncAll();
    expect(await a.local.getNovel(id)).toBeDefined();
    expect(otherAccount.appFileNames()).toEqual([mainName(id)]);
  });

  it('다른 기기가 방금 올린 내용을 모르고 덮어쓰지 않는다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1, s2 } = await seeded(drive);
    await edit(a.local, id, (n) => updateNode(n, s1, { plot: 'A' }));
    await edit(b.local, id, (n) => updateNode(n, s2, { plot: 'B' }));
    // A가 목록을 읽은 뒤 올리기 직전에 B가 먼저 올리는 상황
    let raced = false;
    const racing: DriveApi = {
      // A가 목록을 읽은 직후, A가 올리기 전에 B가 먼저 올린다
      listAppFiles: async () => {
        const list = await drive.listAppFiles();
        if (!raced) {
          raced = true;
          await b.engine.syncAll();
        }
        return list;
      },
      download: (fileId) => drive.download(fileId),
      createAppFile: (name, content) => drive.createAppFile(name, content),
      updateFile: (fileId, content) => drive.updateFile(fileId, content),
      deleteFile: (fileId) => drive.deleteFile(fileId),
      ensureFolder: (name) => drive.ensureFolder(name),
      upsertGoogleDoc: (opts) => drive.upsertGoogleDoc(opts),
      getFile: (fileId: string): Promise<DriveFile> => drive.getFile(fileId),
    };
    const a2 = new SyncEngine({ local: a.local, drive: racing, auth: () => 'active', onStatus: () => {}, onChanged: () => {} });
    engines.push(a2);
    await a2.syncAll();
    await a2.syncAll();
    await b.engine.syncAll();
    const remote = await remoteNovel(drive, id);
    expect(remote.nodes[s1].plot).toBe('A');
    expect(remote.nodes[s2].plot).toBe('B');
  });

  it('토큰이 만료되면 조용히 다시 받고, 실패하면 로그인 필요', async () => {
    const drive = new FakeDrive();
    let state: AuthState = 'expired';
    const ok = await device(drive, undefined, () => state, async () => { state = 'active'; });
    await ok.engine.syncAll();
    expect(ok.last()).toBe('saved');

    const fail = await device(drive, undefined, 'expired', async () => { throw new AuthError('popup_blocked'); });
    await fail.engine.syncAll();
    expect(fail.last()).toBe('needs-login');

    const noReauth = await device(drive, undefined, 'expired');
    await noReauth.engine.syncAll();
    expect(noReauth.last()).toBe('needs-login');
  });
});
