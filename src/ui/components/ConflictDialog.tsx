import { htmlToText } from '../../model/text';
import type { Node } from '../../model/types';
import { useApp } from '../store';

function Side({ label, node }: { label: string; node: Node }) {
  return (
    <div className="conflict-side">
      <h4>{label}</h4>
      <p className="conflict-name">{node.title}</p>
      {node.plot && <p className="muted">{node.plot}</p>}
      <div className="conflict-body">{htmlToText(node.body ?? '')}</div>
    </div>
  );
}

export default function ConflictDialog() {
  const conflicts = useApp((s) => s.conflicts);
  const novels = useApp((s) => s.novels);
  const resolve = useApp((s) => s.resolve);
  const first = Object.entries(conflicts).find(([, list]) => list.length > 0);
  if (!first) return null;
  const [novelId, list] = first;
  const c = list[0];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>두 기기에서 같은 부분을 고쳤어요</h3>
        <p className="muted">
          {novels[novelId]?.title} · 남은 충돌 {list.length}개
        </p>
        <div className="conflict-grid">
          <Side label="이 기기" node={c.local} />
          <Side label="다른 기기" node={c.remote} />
        </div>
        <div className="modal-actions">
          <button onClick={() => void resolve(novelId, c, 'local')}>이 기기 것 남기기</button>
          <button onClick={() => void resolve(novelId, c, 'remote')}>다른 기기 것 남기기</button>
          <button className="primary" onClick={() => void resolve(novelId, c, 'both')}>
            둘 다 보존
          </button>
        </div>
      </div>
    </div>
  );
}
