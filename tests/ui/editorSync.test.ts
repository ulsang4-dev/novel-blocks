import { describe, expect, it } from 'vitest';
import { shouldApplyIncoming } from '../../src/ui/editorSync';

describe('shouldApplyIncoming', () => {
  it('포커스 중이어도 아직 저장 안 된 입력이 없으면 다른 기기의 본문을 반영한다', () => {
    expect(shouldApplyIncoming('<p>원격</p>', '<p>옛 본문</p>', false)).toBe(true);
  });
  it('저장 대기 중인 입력이 있으면 덮어쓰지 않는다', () => {
    expect(shouldApplyIncoming('<p>원격</p>', '<p>입력 중</p>', true)).toBe(false);
  });
  it('내용이 같으면 다시 넣지 않는다(커서 유지)', () => {
    expect(shouldApplyIncoming('<p>같음</p>', '<p>같음</p>', false)).toBe(false);
  });
  it('빈 본문과 빈 문단은 같은 것으로 본다', () => {
    expect(shouldApplyIncoming('', '<p></p>', false)).toBe(false);
  });
});
