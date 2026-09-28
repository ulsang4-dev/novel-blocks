import { newId } from './id';
import type { Node, NodeKind, Novel } from './types';

export class TreeError extends Error {}

export type NodePatch = Partial<Pick<Node, 'title' | 'plot' | 'color' | 'characters' | 'memo' | 'body' | 'status'>>;

export interface AddNodeInput {
  parentId: string | null;
  kind: NodeKind;
  title: string;
  index?: number;
  plot?: string;
  guide?: string;
}

// 같은 밀리초 안의 연속 수정도 수정 시각이 반드시 커지도록 한다(동기화의 "변경 여부" 판단에 쓰임)
export function stamp(prev: number): number {
  return Math.max(Date.now(), prev + 1);
}

export function emptyNovel(title: string, templateId = 'blank'): Novel {
  const now = Date.now();
  return { id: newId(), title, templateId, rootIds: [], nodes: {}, createdAt: now, updatedAt: now };
}

export function getNode(novel: Novel, id: string): Node {
  const node = novel.nodes[id];
  if (!node) throw new TreeError(`노드를 찾을 수 없어요: ${id}`);
  return node;
}

export function childIdsOf(novel: Novel, parentId: string | null): string[] {
  return parentId === null ? novel.rootIds : getNode(novel, parentId).childIds;
}

export function findParentId(novel: Novel, id: string): string | null {
  if (novel.rootIds.includes(id)) return null;
  for (const node of Object.values(novel.nodes)) {
    if (node.childIds.includes(id)) return node.id;
  }
  throw new TreeError(`부모를 찾을 수 없어요: ${id}`);
}

export function ancestors(novel: Novel, id: string): Node[] {
  const out: Node[] = [];
  let parentId = findParentId(novel, id);
  while (parentId !== null) {
    out.unshift(getNode(novel, parentId));
    parentId = findParentId(novel, parentId);
  }
  return out;
}

function setChildIds(novel: Novel, parentId: string | null, childIds: string[]): Novel {
  if (parentId === null) return { ...novel, rootIds: childIds };
  const parent = getNode(novel, parentId);
  return { ...novel, nodes: { ...novel.nodes, [parentId]: { ...parent, childIds } } };
}

function insertAt<T>(list: T[], index: number, item: T): T[] {
  const i = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, i), item, ...list.slice(i)];
}

export function addNode(novel: Novel, input: AddNodeInput): { novel: Novel; id: string } {
  if (input.parentId !== null && getNode(novel, input.parentId).kind === 'scene') {
    throw new TreeError('씬 안에는 다른 항목을 넣을 수 없어요');
  }
  const now = stamp(novel.updatedAt);
  const id = newId();
  const common = { id, title: input.title, plot: input.plot ?? '', guide: input.guide, childIds: [], updatedAt: now };
  const node: Node =
    input.kind === 'scene'
      ? { ...common, kind: 'scene', characters: [], memo: '', body: '', status: 'idea' }
      : { ...common, kind: 'block' };
  const siblings = childIdsOf(novel, input.parentId);
  const withNode = { ...novel, nodes: { ...novel.nodes, [id]: node } };
  const next = setChildIds(withNode, input.parentId, insertAt(siblings, input.index ?? siblings.length, id));
  return { novel: { ...next, updatedAt: now }, id };
}

export function updateNode(novel: Novel, id: string, patch: NodePatch): Novel {
  const now = stamp(novel.updatedAt);
  const node = getNode(novel, id);
  return { ...novel, nodes: { ...novel.nodes, [id]: { ...node, ...patch, updatedAt: now } }, updatedAt: now };
}

export function moveNode(novel: Novel, id: string, newParentId: string | null, index: number): Novel {
  if (newParentId !== null) {
    if (getNode(novel, newParentId).kind === 'scene') throw new TreeError('씬 안으로는 옮길 수 없어요');
    if (newParentId === id || ancestors(novel, newParentId).some((a) => a.id === id)) {
      throw new TreeError('자기 안으로는 옮길 수 없어요');
    }
  }
  const oldParentId = findParentId(novel, id);
  const removed = setChildIds(novel, oldParentId, childIdsOf(novel, oldParentId).filter((c) => c !== id));
  const next = setChildIds(removed, newParentId, insertAt(childIdsOf(removed, newParentId), index, id));
  return { ...next, updatedAt: stamp(novel.updatedAt) };
}

export function deleteNode(novel: Novel, id: string): Novel {
  const parentId = findParentId(novel, id);
  const next = setChildIds(novel, parentId, childIdsOf(novel, parentId).filter((c) => c !== id));
  const nodes = { ...next.nodes };
  const drop = (nid: string) => {
    const n = nodes[nid];
    if (!n) return;
    delete nodes[nid];
    n.childIds.forEach(drop);
  };
  drop(id);
  return { ...next, nodes, updatedAt: stamp(novel.updatedAt) };
}

export function splitBlock(novel: Novel, id: string, atIndex: number): { novel: Novel; id: string } {
  const block = getNode(novel, id);
  if (block.kind !== 'block') throw new TreeError('덩어리만 나눌 수 있어요');
  const parentId = findParentId(novel, id);
  const position = childIdsOf(novel, parentId).indexOf(id) + 1;
  const added = addNode(novel, { parentId, kind: 'block', title: `${block.title} (나뉨)`, index: position });
  const nodes = {
    ...added.novel.nodes,
    [id]: { ...block, childIds: block.childIds.slice(0, atIndex) },
    [added.id]: { ...added.novel.nodes[added.id], childIds: block.childIds.slice(atIndex) },
  };
  return { novel: { ...added.novel, nodes }, id: added.id };
}

export function mergeWithNext(novel: Novel, id: string): Novel {
  const block = getNode(novel, id);
  const parentId = findParentId(novel, id);
  const siblings = childIdsOf(novel, parentId);
  const nextId = siblings[siblings.indexOf(id) + 1];
  if (!nextId) throw new TreeError('합칠 다음 덩어리가 없어요');
  const next = getNode(novel, nextId);
  if (block.kind !== 'block' || next.kind !== 'block') throw new TreeError('덩어리끼리만 합칠 수 있어요');
  const now = stamp(novel.updatedAt);
  const plot = [block.plot, next.plot].filter((p) => p.trim()).join('\n\n');
  const nodes = { ...novel.nodes, [id]: { ...block, plot, childIds: [...block.childIds, ...next.childIds], updatedAt: now } };
  delete nodes[nextId];
  const merged = setChildIds({ ...novel, nodes }, parentId, siblings.filter((s) => s !== nextId));
  return { ...merged, updatedAt: now };
}

export function orderedScenes(novel: Novel, underId?: string): Node[] {
  const out: Node[] = [];
  const walk = (ids: string[]) => {
    for (const cid of ids) {
      const n = getNode(novel, cid);
      if (n.kind === 'scene') out.push(n);
      else walk(n.childIds);
    }
  };
  walk(underId ? getNode(novel, underId).childIds : novel.rootIds);
  return out;
}

export function blocksAtDepth(novel: Novel, depth: number): Node[] {
  const out: Node[] = [];
  const walk = (ids: string[], d: number) => {
    for (const cid of ids) {
      const n = getNode(novel, cid);
      if (n.kind !== 'block') continue;
      if (d === depth) out.push(n);
      else walk(n.childIds, d + 1);
    }
  };
  walk(novel.rootIds, 1);
  return out;
}

export function maxBlockDepth(novel: Novel): number {
  const depthOf = (ids: string[]): number =>
    Math.max(0, ...ids.map((cid) => {
      const n = getNode(novel, cid);
      return n.kind === 'block' ? 1 + depthOf(n.childIds) : 0;
    }));
  return depthOf(novel.rootIds);
}

export function setNovelFields(
  novel: Novel,
  patch: Partial<Pick<Novel, 'title' | 'exportDocId' | 'outlineDocId'>>,
): Novel {
  return { ...novel, ...patch, updatedAt: stamp(novel.updatedAt) };
}
