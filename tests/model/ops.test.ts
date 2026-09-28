import { describe, expect, it } from 'vitest';
import {
  addNode, ancestors, blocksAtDepth, deleteNode, emptyNovel, findParentId, maxBlockDepth,
  mergeWithNext, moveNode, orderedScenes, splitBlock, TreeError, updateNode,
} from '../../src/model/ops';
import type { Node } from '../../src/model/types';

function sample() {
  let n = emptyNovel('테스트');
  const a = addNode(n, { parentId: null, kind: 'block', title: '1막', plot: '시작' }); n = a.novel;
  const b = addNode(n, { parentId: null, kind: 'block', title: '2막', plot: '전개' }); n = b.novel;
  const s1 = addNode(n, { parentId: a.id, kind: 'scene', title: '씬1' }); n = s1.novel;
  const s2 = addNode(n, { parentId: a.id, kind: 'scene', title: '씬2' }); n = s2.novel;
  const s3 = addNode(n, { parentId: b.id, kind: 'scene', title: '씬3' }); n = s3.novel;
  return { n, act1: a.id, act2: b.id, s1: s1.id, s2: s2.id, s3: s3.id };
}
const titles = (nodes: Node[]) => nodes.map((x) => x.title);

describe('addNode', () => {
  it('순서대로 붙이고 부모를 기록한다', () => {
    const { n, act1, s1 } = sample();
    expect(titles(orderedScenes(n))).toEqual(['씬1', '씬2', '씬3']);
    expect(findParentId(n, s1)).toBe(act1);
  });
  it('index 위치에 끼워 넣는다', () => {
    const { n, act1 } = sample();
    const r = addNode(n, { parentId: act1, kind: 'scene', title: '씬0', index: 0 });
    expect(titles(orderedScenes(r.novel))).toEqual(['씬0', '씬1', '씬2', '씬3']);
  });
  it('씬 안에는 넣을 수 없다', () => {
    const { n, s1 } = sample();
    expect(() => addNode(n, { parentId: s1, kind: 'scene', title: 'x' })).toThrow(TreeError);
  });
  it('새 씬은 기본값을 가진다', () => {
    const { n, s1 } = sample();
    expect(n.nodes[s1]).toMatchObject({ body: '', memo: '', characters: [], status: 'idea', plot: '' });
  });
});

describe('updateNode', () => {
  it('내용을 바꾸고 수정 시각을 올린다', () => {
    const { n, s1 } = sample();
    const next = updateNode(n, s1, { plot: '만남' });
    expect(next.nodes[s1].plot).toBe('만남');
    expect(next.updatedAt).toBeGreaterThan(n.updatedAt);
    expect(n.nodes[s1].plot).toBe(''); // 원본 불변
  });
});

describe('moveNode', () => {
  it('같은 부모 안에서 최종 위치로 옮긴다', () => {
    const { n, act1, s1 } = sample();
    expect(titles(orderedScenes(moveNode(n, s1, act1, 1)))).toEqual(['씬2', '씬1', '씬3']);
  });
  it('다른 부모로 옮긴다', () => {
    const { n, act1, s3 } = sample();
    expect(titles(orderedScenes(moveNode(n, s3, act1, 0)))).toEqual(['씬3', '씬1', '씬2']);
  });
  it('자기 자손 안으로는 옮길 수 없다', () => {
    const { n, act1 } = sample();
    const sub = addNode(n, { parentId: act1, kind: 'block', title: '장' });
    expect(() => moveNode(sub.novel, act1, sub.id, 0)).toThrow(TreeError);
  });
  it('씬 안으로는 옮길 수 없다', () => {
    const { n, s1, s2 } = sample();
    expect(() => moveNode(n, s2, s1, 0)).toThrow(TreeError);
  });
});

describe('deleteNode', () => {
  it('하위 전체를 지운다', () => {
    const { n, act1, s1, s2 } = sample();
    const next = deleteNode(n, act1);
    expect(next.nodes[s1]).toBeUndefined();
    expect(next.nodes[s2]).toBeUndefined();
    expect(titles(orderedScenes(next))).toEqual(['씬3']);
  });
});

describe('splitBlock / mergeWithNext', () => {
  it('자식 목록을 기준 위치에서 둘로 나눈다', () => {
    const { n, act1, s1, s2 } = sample();
    const r = splitBlock(n, act1, 1);
    expect(r.novel.rootIds).toEqual([act1, r.id, n.rootIds[1]]);
    expect(r.novel.nodes[act1].childIds).toEqual([s1]);
    expect(r.novel.nodes[r.id].childIds).toEqual([s2]);
    expect(r.novel.nodes[r.id].title).toBe('1막 (나뉨)');
  });
  it('다음 덩어리와 합치며 플롯을 잇는다', () => {
    const { n, act1, s1, s2, s3 } = sample();
    const next = mergeWithNext(n, act1);
    expect(next.rootIds).toEqual([act1]);
    expect(next.nodes[act1].childIds).toEqual([s1, s2, s3]);
    expect(next.nodes[act1].plot).toBe('시작\n\n전개');
  });
  it('마지막 덩어리는 합칠 수 없다', () => {
    const { n, act2 } = sample();
    expect(() => mergeWithNext(n, act2)).toThrow(TreeError);
  });
});

describe('깊이와 조상', () => {
  it('덩어리 깊이와 조상을 계산한다', () => {
    const { n, act2 } = sample();
    const sub = addNode(n, { parentId: act2, kind: 'block', title: '장' });
    const sc = addNode(sub.novel, { parentId: sub.id, kind: 'scene', title: '깊은 씬' });
    expect(maxBlockDepth(sc.novel)).toBe(2);
    expect(titles(blocksAtDepth(sc.novel, 1))).toEqual(['1막', '2막']);
    expect(titles(blocksAtDepth(sc.novel, 2))).toEqual(['장']);
    expect(titles(ancestors(sc.novel, sc.id))).toEqual(['2막', '장']);
  });
});
