import { describe, expect, it } from 'vitest';
import { blocksAtDepth, TreeError } from '../../src/model/ops';
import { createNovel, TEMPLATES } from '../../src/model/templates';

describe('createNovel', () => {
  it.each([
    ['blank', 1, 0],
    ['kishotenketsu', 4, 0],
    ['three-act', 3, 7],
    ['save-the-cat', 3, 15],
  ])('%s 템플릿은 최상위 %i개, 2단계 %i개 덩어리를 만든다', (id, roots, second) => {
    const novel = createNovel('제목', id);
    expect(novel.rootIds).toHaveLength(roots);
    expect(blocksAtDepth(novel, 2)).toHaveLength(second);
    expect(novel.templateId).toBe(id);
    expect(novel.title).toBe('제목');
  });

  it('모든 덩어리에 안내 문구가 있다', () => {
    for (const t of TEMPLATES) {
      const novel = createNovel('x', t.id);
      for (const node of Object.values(novel.nodes)) expect(node.guide, `${t.id}/${node.title}`).toBeTruthy();
    }
  });

  it('없는 템플릿은 오류', () => {
    expect(() => createNovel('x', 'nope')).toThrow(TreeError);
  });
});
