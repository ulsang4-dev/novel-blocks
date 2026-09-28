import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { addNode, childIdsOf, deleteNode, findParentId, mergeWithNext, moveNode, splitBlock, updateNode } from '../../model/ops';
import { charCount } from '../../model/text';
import { SCENE_STATUS_LABEL, type Novel } from '../../model/types';
import { LABEL_COLORS } from '../colors';
import EditableText from '../components/EditableText';
import NotFound from '../components/NotFound';
import { useNovel, type Change } from '../hooks';

interface TreeProps {
  novel: Novel;
  ids: string[];
  parentId: string | null;
  change: Change;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}

export default function Outline() {
  const { novel, change } = useNovel();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!novel) return <NotFound />;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="page outline">
      <div className="page-head">
        <h1>목차</h1>
        <button onClick={() => change((n) => addNode(n, { parentId: null, kind: 'block', title: '새 덩어리' }).novel)}>
          + 최상위 덩어리
        </button>
      </div>
      <Tree novel={novel} ids={novel.rootIds} parentId={null} change={change} collapsed={collapsed} toggle={toggle} />
    </div>
  );
}

function Tree(props: TreeProps) {
  return (
    <ul className="tree">
      {props.ids.map((id, index) => (
        <Row key={id} {...props} id={id} index={index} />
      ))}
    </ul>
  );
}

function Row({ novel, ids, parentId, change, collapsed, toggle, id, index }: TreeProps & { id: string; index: number }) {
  const node = novel.nodes[id];
  const prev = index > 0 ? novel.nodes[ids[index - 1]] : undefined;
  const next = novel.nodes[ids[index + 1]];
  const isBlock = node.kind === 'block';
  const closed = collapsed.has(id);

  // 메뉴 항목을 누르면 메뉴를 닫고 변경을 적용한다
  const run = (fn: (n: Novel) => Novel) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.closest('details')?.removeAttribute('open');
    change(fn);
  };

  return (
    <li>
      <div className="tree-row" style={node.color ? { boxShadow: `inset 3px 0 0 ${node.color}` } : undefined}>
        {isBlock ? (
          <button className="tree-toggle" onClick={() => toggle(id)} aria-label={closed ? '펼치기' : '접기'}>
            {closed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="tree-toggle">·</span>
        )}
        <div className="tree-body">
          <EditableText value={node.title} onCommit={(title) => change((n) => updateNode(n, id, { title }))} />
          <EditableText
            multiline
            className="plot"
            value={node.plot}
            placeholder={node.guide ?? (isBlock ? '이 덩어리의 플롯' : '이 씬에서 일어날 일')}
            onCommit={(plot) => change((n) => updateNode(n, id, { plot }))}
          />
          {!isBlock && (
            <div className="tree-meta">
              {SCENE_STATUS_LABEL[node.status ?? 'idea']} · {charCount(node.body).toLocaleString()}자 ·{' '}
              <Link to={`/n/${novel.id}/write/${id}`}>쓰기 →</Link>
            </div>
          )}
        </div>
        <details className="row-menu">
          <summary aria-label="메뉴">⋯</summary>
          <div className="menu">
            <div className="swatches" aria-label="색상 라벨">
              {LABEL_COLORS.map((c) => (
                <button key={c} className="swatch" style={{ background: c }} aria-label={`색상 ${c}`} onClick={run((n) => updateNode(n, id, { color: c }))} />
              ))}
              <button className="swatch none" aria-label="색상 없음" onClick={run((n) => updateNode(n, id, { color: undefined }))}>×</button>
            </div>
            {isBlock && <button onClick={run((n) => addNode(n, { parentId: id, kind: 'scene', title: '새 씬' }).novel)}>+ 씬 추가</button>}
            {isBlock && <button onClick={run((n) => addNode(n, { parentId: id, kind: 'block', title: '새 덩어리' }).novel)}>+ 하위 덩어리</button>}
            <button disabled={index === 0} onClick={run((n) => moveNode(n, id, parentId, index - 1))}>위로</button>
            <button disabled={!next} onClick={run((n) => moveNode(n, id, parentId, index + 1))}>아래로</button>
            <button disabled={prev?.kind !== 'block'} onClick={run((n) => moveNode(n, id, prev!.id, prev!.childIds.length))}>
              들여쓰기 (앞 덩어리 안으로)
            </button>
            <button
              disabled={parentId === null}
              onClick={run((n) => {
                const grand = findParentId(n, parentId!);
                return moveNode(n, id, grand, childIdsOf(n, grand).indexOf(parentId!) + 1);
              })}
            >
              내어쓰기 (밖으로)
            </button>
            {parentId !== null && index > 0 && (
              <button onClick={run((n) => splitBlock(n, parentId, index).novel)}>여기서 덩어리 나누기</button>
            )}
            {isBlock && (
              <button disabled={next?.kind !== 'block'} onClick={run((n) => mergeWithNext(n, id))}>다음 덩어리와 합치기</button>
            )}
            <button
              className="danger"
              onClick={(e) => {
                const what = isBlock ? `“${node.title}”과(와) 그 안의 모든 내용` : `“${node.title}”`;
                if (confirm(`${what}을(를) 삭제할까요?`)) run((n) => deleteNode(n, id))(e);
              }}
            >
              삭제
            </button>
          </div>
        </details>
      </div>
      {isBlock && !closed && node.childIds.length > 0 && (
        <Tree novel={novel} ids={node.childIds} parentId={id} change={change} collapsed={collapsed} toggle={toggle} />
      )}
    </li>
  );
}
