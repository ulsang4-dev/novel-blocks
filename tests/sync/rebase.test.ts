import { describe, expect, it } from 'vitest';
import { addNode, deleteNode, updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import { rebaseEdit } from '../../src/sync/rebase';

function sample() {
  let n = createNovel('재적용', 'blank');
  const block = n.rootIds[0];
  const s1 = addNode(n, { parentId: block, kind: 'scene', title: '씬1' }); n = s1.novel;
  const s2 = addNode(n, { parentId: block, kind: 'scene', title: '씬2' }); n = s2.novel;
  return { n, s1: s1.id, s2: s2.id };
}

describe('rebaseEdit', () => {
  it('저장소가 그대로면 화면에서 만든 결과를 그대로 쓴다', () => {
    const { n, s2 } = sample();
    const fn = (x: typeof n) => updateNode(x, s2, { plot: '편집' });
    const next = fn(n);
    expect(rebaseEdit(n, n, next, fn)).toBe(next);
  });

  it('그 사이 병합된 다른 기기의 글을 지우지 않고 편집을 다시 적용한다', () => {
    const { n, s1, s2 } = sample();
    const merged = updateNode(n, s1, { body: '<p>다른 기기의 글</p>' }); // 동기화 엔진이 저장한 병합본
    const fn = (x: typeof n) => updateNode(x, s2, { plot: '방금 입력' });
    const staleNext = fn(n); // 화면은 병합 전 사본으로 계산함
    const result = rebaseEdit(merged, n, staleNext, fn);
    expect(result.nodes[s1].body).toBe('<p>다른 기기의 글</p>');
    expect(result.nodes[s2].plot).toBe('방금 입력');
    expect(result.updatedAt).toBeGreaterThan(merged.updatedAt);
  });

  it('다시 적용할 수 없으면 3-way 병합으로 둘 다 살린다', () => {
    const { n, s1, s2 } = sample();
    const merged = deleteNode(updateNode(n, s1, { body: '<p>원격</p>' }), s2); // 다른 기기에서 s2 삭제
    const fn = (x: typeof n) => updateNode(x, s2, { body: '<p>로컬</p>' }); // s2가 없으면 throw
    const result = rebaseEdit(merged, n, fn(n), fn);
    expect(result.nodes[s1].body).toBe('<p>원격</p>');
    expect(result.nodes[s2].body).toBe('<p>로컬</p>');
  });

  it('저장소에서 사라진 작품은 화면의 편집본으로 되살린다', () => {
    const { n, s2 } = sample();
    const fn = (x: typeof n) => updateNode(x, s2, { plot: '살림' });
    const next = fn(n);
    expect(rebaseEdit(undefined, n, next, fn)).toBe(next);
  });
});
