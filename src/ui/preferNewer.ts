import type { Novel } from '../model/types';

/** 저장소에서 다시 읽은 목록과 화면 상태를 합친다. 아직 저장이 끝나지 않은 더 최신 편집은 보존한다. */
export function preferNewer(current: Record<string, Novel>, loaded: Novel[]): Record<string, Novel> {
  const out: Record<string, Novel> = {};
  for (const n of loaded) {
    const mine = current[n.id];
    out[n.id] = mine && mine.updatedAt > n.updatedAt ? mine : n;
  }
  return out;
}
