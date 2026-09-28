import { describe, expect, it } from 'vitest';
import { updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import { preferNewer } from '../../src/ui/preferNewer';

describe('preferNewer', () => {
  it('화면에 더 최신 편집이 있으면 불러온 것보다 우선한다', () => {
    const stored = createNovel('a', 'blank');
    const typing = updateNode(stored, stored.rootIds[0], { plot: '입력 중' });
    const out = preferNewer({ [stored.id]: typing }, [stored]);
    expect(out[stored.id]).toBe(typing);
  });
  it('불러온 것이 같거나 최신이면 불러온 것을 쓰고, 사라진 작품은 뺀다', () => {
    const a = createNovel('a', 'blank');
    const gone = createNovel('gone', 'blank');
    const merged = { ...a, title: '병합됨' };
    const out = preferNewer({ [a.id]: a, [gone.id]: gone }, [merged]);
    expect(out[a.id].title).toBe('병합됨');
    expect(out[gone.id]).toBeUndefined();
  });
});
