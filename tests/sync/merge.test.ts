import { describe, expect, it } from 'vitest';
import { addNode, deleteNode, emptyNovel, moveNode, updateNode } from '../../src/model/ops';
import type { Novel } from '../../src/model/types';
import { mergeNovels, mergeOrder, normalizeTree, resolveConflict } from '../../src/sync/merge';

function base() {
  let n = emptyNovel('작품');
  const act = addNode(n, { parentId: null, kind: 'block', title: '1막' }); n = act.novel;
  const act2 = addNode(n, { parentId: null, kind: 'block', title: '2막' }); n = act2.novel;
  const s1 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬1' }); n = s1.novel;
  const s2 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬2' }); n = s2.novel;
  return { n, act: act.id, act2: act2.id, s1: s1.id, s2: s2.id };
}
const occurrences = (novel: Novel, id: string) =>
  [novel.rootIds, ...Object.values(novel.nodes).map((x) => x.childIds)].flat().filter((x) => x === id).length;

describe('mergeOrder', () => {
  it('한쪽만 바뀌면 그쪽을 따른다', () => {
    expect(mergeOrder(['a', 'b'], ['b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
    expect(mergeOrder(['a', 'b'], ['a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
  });
  it('양쪽이 바뀌면 원격 순서에 로컬 새 항목을 뒤에 붙인다', () => {
    expect(mergeOrder(['a', 'b'], ['a', 'b', 'L'], ['b', 'a', 'R'])).toEqual(['b', 'a', 'R', 'L']);
  });
  it('로컬에서 뺀 항목은 빠진다', () => {
    expect(mergeOrder(['a', 'b', 'c'], ['a', 'c'], ['c', 'b', 'a', 'R'])).toEqual(['c', 'a', 'R']);
  });
});

describe('mergeNovels', () => {
  it('원격만 바뀐 씬은 원격을 따른다', () => {
    const { n, s1 } = base();
    const { merged, conflicts } = mergeNovels(n, n, updateNode(n, s1, { plot: '원격' }));
    expect(merged.nodes[s1].plot).toBe('원격');
    expect(conflicts).toEqual([]);
  });

  it('서로 다른 씬을 고치면 둘 다 반영한다', () => {
    const { n, s1, s2 } = base();
    const { merged, conflicts } = mergeNovels(n, updateNode(n, s1, { plot: '로컬' }), updateNode(n, s2, { plot: '원격' }));
    expect(merged.nodes[s1].plot).toBe('로컬');
    expect(merged.nodes[s2].plot).toBe('원격');
    expect(conflicts).toEqual([]);
  });

  it('같은 씬을 다르게 고치면 충돌이고 로컬을 유지한다', () => {
    const { n, s1 } = base();
    const { merged, conflicts } = mergeNovels(n, updateNode(n, s1, { body: '<p>A</p>' }), updateNode(n, s1, { body: '<p>B</p>' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].nodeId).toBe(s1);
    expect(conflicts[0].remote.body).toBe('<p>B</p>');
    expect(merged.nodes[s1].body).toBe('<p>A</p>');
  });

  it('같은 내용으로 고치면 충돌이 아니다', () => {
    const { n, s1 } = base();
    const { conflicts } = mergeNovels(n, updateNode(n, s1, { body: '<p>같음</p>' }), updateNode(n, s1, { body: '<p>같음</p>' }));
    expect(conflicts).toEqual([]);
  });

  it('원격에서 지웠고 로컬이 그대로면 지운다', () => {
    const { n, act, s1, s2 } = base();
    const { merged } = mergeNovels(n, n, deleteNode(n, s2));
    expect(merged.nodes[s2]).toBeUndefined();
    expect(merged.nodes[act].childIds).toEqual([s1]);
  });

  it('원격에서 지웠어도 로컬에서 고쳤으면 원래 자리에 살린다', () => {
    const { n, act, s1, s2 } = base();
    const { merged } = mergeNovels(n, updateNode(n, s2, { body: '<p>살려</p>' }), deleteNode(n, s2));
    expect(merged.nodes[s2].body).toBe('<p>살려</p>');
    expect(merged.nodes[act].childIds).toEqual([s1, s2]);
  });

  it('양쪽에서 추가한 씬은 모두 남는다', () => {
    const { n, act } = base();
    const l = addNode(n, { parentId: act, kind: 'scene', title: 'L' });
    const r = addNode(n, { parentId: act, kind: 'scene', title: 'R' });
    const { merged } = mergeNovels(n, l.novel, r.novel);
    expect(merged.nodes[act].childIds.slice(-2)).toEqual([r.id, l.id]);
  });

  it('양쪽이 다른 곳으로 옮긴 씬은 한 번만 나타난다', () => {
    const { n, act, act2, s1 } = base();
    const { merged } = mergeNovels(n, moveNode(n, s1, act2, 0), moveNode(n, s1, act, 1));
    expect(occurrences(merged, s1)).toBe(1);
  });

  it('부모가 사라진 새 씬은 최상위로 붙는다', () => {
    const { n, act2 } = base();
    const l = addNode(n, { parentId: act2, kind: 'scene', title: '고아' });
    const { merged } = mergeNovels(n, l.novel, deleteNode(n, act2));
    expect(merged.nodes[act2]).toBeUndefined();
    expect(merged.rootIds).toContain(l.id);
  });

  it('기준본이 없으면 양쪽을 합친다', () => {
    const { n, s1 } = base();
    const { merged, conflicts } = mergeNovels(undefined, n, updateNode(n, s1, { plot: '다름' }));
    expect(conflicts).toHaveLength(1);
    expect(Object.keys(merged.nodes)).toHaveLength(4);
  });

  it('작품 제목도 3-way로 합친다', () => {
    const { n } = base();
    const { merged } = mergeNovels(n, n, { ...n, title: '새 제목' });
    expect(merged.title).toBe('새 제목');
  });
});

describe('normalizeTree', () => {
  it('없는 id와 씬의 자식을 정리한다', () => {
    const { n, s1, s2 } = base();
    const broken: Novel = {
      ...n,
      rootIds: [...n.rootIds, 'ghost'],
      nodes: { ...n.nodes, [s1]: { ...n.nodes[s1], childIds: [s2] } },
    };
    const fixed = normalizeTree(broken);
    expect(fixed.rootIds).not.toContain('ghost');
    expect(fixed.nodes[s1].childIds).toEqual([]);
    expect(occurrences(fixed, s2)).toBe(1);
  });
});

describe('resolveConflict', () => {
  function conflicted() {
    const { n, act, s1 } = base();
    const { merged, conflicts } = mergeNovels(n, updateNode(n, s1, { body: '<p>A</p>' }), updateNode(n, s1, { body: '<p>B</p>' }));
    return { merged, c: conflicts[0], act, s1 };
  }
  it('local은 이 기기 내용을 남긴다', () => {
    const { merged, c, s1 } = conflicted();
    const out = resolveConflict(merged, c, 'local');
    expect(out.nodes[s1].body).toBe('<p>A</p>');
    expect(out.updatedAt).toBeGreaterThan(merged.updatedAt);
  });
  it('remote는 다른 기기 내용으로 바꾼다', () => {
    const { merged, c, s1 } = conflicted();
    expect(resolveConflict(merged, c, 'remote').nodes[s1].body).toBe('<p>B</p>');
  });
  it('both는 다른 기기 내용을 바로 뒤에 복제한다', () => {
    const { merged, c, act, s1 } = conflicted();
    const out = resolveConflict(merged, c, 'both');
    const list = out.nodes[act].childIds;
    const copyId = list[list.indexOf(s1) + 1];
    expect(out.nodes[s1].body).toBe('<p>A</p>');
    expect(out.nodes[copyId].body).toBe('<p>B</p>');
    expect(out.nodes[copyId].title).toBe('씬1 (다른 기기)');
  });
});
