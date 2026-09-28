import { describe, expect, it } from 'vitest';
import { charCount, htmlToText } from '../../src/model/text';

describe('htmlToText', () => {
  it('문단을 줄바꿈으로 바꾸고 태그와 엔티티를 푼다', () => {
    expect(htmlToText('<p>가 &amp; 나</p><p>다<br>라</p>')).toBe('가 & 나\n다\n라\n');
  });
});

describe('charCount', () => {
  it('공백 포함, 줄바꿈 제외로 센다', () => {
    expect(charCount('<p>안녕 하세요</p><p>반가워</p>')).toBe(9);
  });
  it('빈 값은 0', () => {
    expect(charCount(undefined)).toBe(0);
    expect(charCount('')).toBe(0);
  });
});
