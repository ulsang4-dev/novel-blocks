import {
  closestCorners, DndContext, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addNode, blocksAtDepth, childIdsOf, deleteNode, findParentId, getNode, maxBlockDepth, moveNode, orderedScenes, updateNode,
} from '../../model/ops';
import { charCount } from '../../model/text';
import { SCENE_STATUS_LABEL, type Node, type Novel } from '../../model/types';
import EditableText from '../components/EditableText';
import NotFound from '../components/NotFound';
import { useNovel, type Change } from '../hooks';

export default function Board() {
  const { novel, change } = useNovel();
  const [depth, setDepth] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  if (!novel) return <NotFound />;

  const maxDepth = Math.max(1, maxBlockDepth(novel));
  const d = Math.min(depth ?? maxDepth, maxDepth);
  const columns = blocksAtDepth(novel, d);
  const lastParent = columns.length ? findParentId(novel, columns[columns.length - 1].id) : null;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const id = String(active.id);
    const overId = String(over.id);
    change((n) => {
      if (overId.startsWith('col:')) {
        const colId = overId.slice(4);
        return moveNode(n, id, colId, getNode(n, colId).childIds.length);
      }
      const parentId = findParentId(n, overId);
      return moveNode(n, id, parentId, childIdsOf(n, parentId).indexOf(overId));
    });
  };

  return (
    <div className="board">
      {maxDepth > 1 && (
        <div className="board-bar">
          <label>
            열 기준{' '}
            <select value={d} onChange={(e) => setDepth(Number(e.target.value))}>
              {Array.from({ length: maxDepth }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}단계 ({blocksAtDepth(novel, i + 1).map((b) => b.title).slice(0, 2).join(', ')}…)
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="columns">
          {columns.map((col) => (
            <Column key={col.id} novel={novel} block={col} columns={columns} change={change} />
          ))}
          <button
            className="ghost add-column"
            onClick={() => change((n) => addNode(n, { parentId: lastParent, kind: 'block', title: '새 덩어리' }).novel)}
          >
            + 덩어리
          </button>
        </div>
      </DndContext>
    </div>
  );
}

function Column({ novel, block, columns, change }: { novel: Novel; block: Node; columns: Node[]; change: Change }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${block.id}` });
  const scenes = orderedScenes(novel, block.id);
  return (
    <section
      ref={setNodeRef}
      className={`column ${isOver ? 'over' : ''}`}
      style={block.color ? { boxShadow: `inset 0 3px 0 ${block.color}` } : undefined}
    >
      <header>
        <EditableText className="column-title" value={block.title} onCommit={(title) => change((n) => updateNode(n, block.id, { title }))} />
        <EditableText
          multiline
          className="plot"
          value={block.plot}
          placeholder={block.guide ?? '이 덩어리의 플롯'}
          onCommit={(plot) => change((n) => updateNode(n, block.id, { plot }))}
        />
      </header>
      <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="cards">
          {scenes.map((s) => (
            <SceneCard key={s.id} novelId={novel.id} scene={s} columns={columns} change={change} />
          ))}
        </div>
      </SortableContext>
      <button className="ghost add" onClick={() => change((n) => addNode(n, { parentId: block.id, kind: 'scene', title: '새 씬' }).novel)}>
        + 씬
      </button>
    </section>
  );
}

function SceneCard({ novelId, scene, columns, change }: { novelId: string; scene: Node; columns: Node[]; change: Change }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  const status = scene.status ?? 'idea';
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        boxShadow: scene.color ? `inset 3px 0 0 ${scene.color}` : undefined,
      }}
      className={`card ${isDragging ? 'dragging' : ''}`}
    >
      <div className="card-top">
        <span className="handle" {...attributes} {...listeners} aria-label="끌어서 옮기기">⋮⋮</span>
        <EditableText value={scene.title} onCommit={(title) => change((n) => updateNode(n, scene.id, { title }))} />
        <button
          className="ghost"
          aria-label="씬 삭제"
          onClick={() => {
            if (confirm(`“${scene.title}”을(를) 삭제할까요?`)) change((n) => deleteNode(n, scene.id));
          }}
        >
          ×
        </button>
      </div>
      <EditableText
        multiline
        className="plot"
        value={scene.plot}
        placeholder="이 씬에서 일어날 일"
        onCommit={(plot) => change((n) => updateNode(n, scene.id, { plot }))}
      />
      <div className="card-foot">
        <span className={`chip chip-${status}`}>{SCENE_STATUS_LABEL[status]}</span>
        <span>{charCount(scene.body).toLocaleString()}자</span>
        <Link to={`/n/${novelId}/write/${scene.id}`}>쓰기 →</Link>
        <select
          aria-label="다른 덩어리로 옮기기"
          value=""
          onChange={(e) => {
            const to = e.target.value;
            change((n) => moveNode(n, scene.id, to, getNode(n, to).childIds.length));
          }}
        >
          <option value="" disabled>옮기기</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>
    </article>
  );
}
