import type { Novel } from '../model/types';
import { mergeNovels } from './merge';

/**
 * 화면에서 만든 편집(next = fn(base))을 저장소의 최신본(stored) 위에 다시 얹는다.
 * 그 사이 동기화 엔진이 병합본을 저장했다면, 병합본을 덮어쓰지 않고 편집만 다시 적용한다.
 */
export function rebaseEdit(
  stored: Novel | undefined,
  base: Novel,
  next: Novel,
  fn: (n: Novel) => Novel,
): Novel {
  if (!stored || stored.updatedAt === base.updatedAt) return next;
  try {
    return fn(stored);
  } catch {
    // 편집 대상이 병합본에서 사라진 경우 등: 삭제보다 수정을 우선하는 3-way 병합으로 둘 다 살린다
    const { merged } = mergeNovels(base, next, stored);
    return { ...merged, updatedAt: Math.max(merged.updatedAt, stored.updatedAt) + 1 };
  }
}
