import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import { LocalStore } from '../../src/storage/local';

let seq = 0;
const open = () => LocalStore.open(`local-test-${++seq}`);

describe('LocalStore', () => {
  it('작품을 저장하고 다시 읽는다', async () => {
    const store = await open();
    const novel = createNovel('하나', 'blank');
    await store.putNovel(novel);
    expect(await store.getNovel(novel.id)).toEqual(novel);
    expect(await store.listNovels()).toHaveLength(1);
  });

  it('deleteNovel은 작품과 기준본을 함께 지운다', async () => {
    const store = await open();
    const novel = createNovel('둘', 'blank');
    await store.putNovel(novel);
    await store.putBase(novel);
    await store.deleteNovel(novel.id);
    expect(await store.getNovel(novel.id)).toBeUndefined();
    expect(await store.getBase(novel.id)).toBeUndefined();
  });

  it('드라이브에 올라간 작품은 삭제 표시를 남긴다', async () => {
    const store = await open();
    const synced = createNovel('올라감', 'blank');
    const localOnly = createNovel('기기만', 'blank');
    await store.putNovel(synced);
    await store.putNovel(localOnly);
    await store.putMeta({ novelId: synced.id, driveFileId: 'f1', syncedAt: synced.updatedAt });
    await store.tombstone(synced.id);
    await store.tombstone(localOnly.id);
    expect(await store.getMeta(synced.id)).toEqual({ novelId: synced.id, driveFileId: 'f1', deleted: true });
    expect(await store.getMeta(localOnly.id)).toBeUndefined();
    expect(await store.listNovels()).toHaveLength(0);
  });

  it('updateNovel은 저장된 최신본을 읽어 한 트랜잭션 안에서 바꾼다', async () => {
    const store = await open();
    const novel = createNovel('원자적', 'blank');
    await store.putNovel(novel);
    const merged = updateNode(novel, novel.rootIds[0], { title: '병합본' });
    await store.putNovel(merged);
    const result = await store.updateNovel(novel.id, (stored) => updateNode(stored!, novel.rootIds[0], { plot: '입력' }));
    const saved = (await store.getNovel(novel.id))!;
    expect(saved).toEqual(result);
    expect(saved.nodes[novel.rootIds[0]]).toMatchObject({ title: '병합본', plot: '입력' });
  });

  it('deleteNovelIf는 그 사이 수정됐으면 지우지 않는다', async () => {
    const store = await open();
    const novel = createNovel('지우기', 'blank');
    await store.putNovel(novel);
    const typed = updateNode(novel, novel.rootIds[0], { plot: '입력' });
    await store.putNovel(typed);
    expect(await store.deleteNovelIf(novel.id, novel.updatedAt)).toBe(false);
    expect(await store.getNovel(novel.id)).toBeDefined();
    expect(await store.deleteNovelIf(novel.id, typed.updatedAt)).toBe(true);
    expect(await store.getNovel(novel.id)).toBeUndefined();
  });

  it('casNovel은 그 사이 수정이 있었으면 덮어쓰지 않는다', async () => {
    const store = await open();
    const novel = createNovel('동시', 'blank');
    await store.putNovel(novel);
    const typed = updateNode(novel, novel.rootIds[0], { plot: '방금 입력' });
    await store.putNovel(typed); // 사용자가 병합 도중 입력
    const merged = updateNode(novel, novel.rootIds[0], { title: '병합 결과' });
    expect(await store.casNovel(merged, novel.updatedAt)).toBe(false);
    expect((await store.getNovel(novel.id))!.nodes[novel.rootIds[0]].plot).toBe('방금 입력');
    expect(await store.casNovel(merged, typed.updatedAt)).toBe(true);
  });
});
