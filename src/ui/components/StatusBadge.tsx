import type { SyncStatus } from '../../sync/engine';
import { useApp } from '../store';

const LABEL: Record<SyncStatus, string> = {
  'local-only': '기기에만 저장',
  saved: '저장됨',
  syncing: '동기화 중',
  offline: '오프라인',
  'needs-login': '로그인 필요',
  conflict: '충돌 있음',
  error: '동기화 오류',
};

export default function StatusBadge() {
  const status = useApp((s) => s.status);
  const detail = useApp((s) => s.statusDetail);
  return (
    <span className={`badge badge-${status}`} title={detail}>
      {LABEL[status]}
    </span>
  );
}
