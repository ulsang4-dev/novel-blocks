import { useNavigate, useParams } from 'react-router-dom';
import { ancestors, orderedScenes, updateNode } from '../../model/ops';
import { charCount } from '../../model/text';
import { SCENE_STATUS_LABEL, type Node, type SceneStatus } from '../../model/types';
import EditableText from '../components/EditableText';
import NotFound from '../components/NotFound';
import SceneEditor from '../components/SceneEditor';
import { useMediaQuery, useNovel } from '../hooks';

export default function Writer() {
  const { novel, change } = useNovel();
  const { sceneId } = useParams();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 768px)');
  if (!novel) return <NotFound />;

  const scenes = orderedScenes(novel);
  const requested = sceneId ? novel.nodes[sceneId] : undefined;
  const scene = requested?.kind === 'scene' ? requested : scenes[0];
  if (!scene) return <div className="page empty">아직 씬이 없어요. 보드에서 “+ 씬”으로 추가해 보세요.</div>;

  const i = scenes.findIndex((s) => s.id === scene.id);
  const go = (s?: Node) => {
    if (s) navigate(`/n/${novel.id}/write/${s.id}`);
  };

  return (
    <div className="writer">
      <aside className="writer-side">
        <details open={wide} key={String(wide)}>
          <summary>플롯 · 메모</summary>
          {ancestors(novel, scene.id).map((a) => (
            <div key={a.id} className="ancestor">
              <span className="muted">{a.title}</span>
              <p>{a.plot || a.guide || '—'}</p>
            </div>
          ))}
          <label>
            씬 플롯
            <EditableText multiline value={scene.plot} placeholder="이 씬에서 일어날 일" onCommit={(plot) => change((n) => updateNode(n, scene.id, { plot }))} />
          </label>
          <label>
            등장인물
            <EditableText
              value={(scene.characters ?? []).join(', ')}
              placeholder="쉼표로 구분"
              onCommit={(v) => change((n) => updateNode(n, scene.id, { characters: v.split(',').map((s) => s.trim()).filter(Boolean) }))}
            />
          </label>
          <label>
            메모
            <EditableText multiline value={scene.memo ?? ''} onCommit={(memo) => change((n) => updateNode(n, scene.id, { memo }))} />
          </label>
          <label>
            상태
            <select
              value={scene.status ?? 'idea'}
              onChange={(e) => change((n) => updateNode(n, scene.id, { status: e.target.value as SceneStatus }))}
            >
              {Object.entries(SCENE_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </details>
      </aside>
      <section className="writer-main">
        <EditableText className="scene-title" value={scene.title} onCommit={(title) => change((n) => updateNode(n, scene.id, { title }))} />
        <SceneEditor key={scene.id} html={scene.body ?? ''} onChange={(body) => change((n) => updateNode(n, scene.id, { body }))} />
        <footer className="writer-foot">
          <button className="ghost" disabled={i <= 0} onClick={() => go(scenes[i - 1])}>← 이전 씬</button>
          <span className="muted">{charCount(scene.body).toLocaleString()}자</span>
          <button className="ghost" disabled={i >= scenes.length - 1} onClick={() => go(scenes[i + 1])}>다음 씬 →</button>
        </footer>
      </section>
    </div>
  );
}
