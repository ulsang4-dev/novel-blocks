import { newId } from '../model/id';
import { childIdsOf, findParentId } from '../model/ops';
import type { Node, Novel } from '../model/types';

export interface Conflict {
  nodeId: string;
  local: Node;
  remote: Node;
}

export type Resolution = 'local' | 'remote' | 'both';

const CONTENT_KEYS = ['kind', 'title', 'plot', 'guide', 'color', 'characters', 'memo', 'body', 'status'] as const;

export function sameContent(a: Node, b: Node): boolean {
  return CONTENT_KEYS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

const sameList = (a?: string[], b?: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export function mergeOrder(base: string[] | undefined, local: string[], remote: string[]): string[] {
  if (sameList(local, remote)) return [...local];
  if (base && sameList(local, base)) return [...remote];
  if (base && sameList(remote, base)) return [...local];
  const b = base ?? [];
  const kept = remote.filter((id) => local.includes(id) || !b.includes(id));
  const added = local.filter((id) => !kept.includes(id) && !b.includes(id));
  return [...kept, ...added];
}

function parentIn(novel: Novel, id: string): string | null | undefined {
  if (novel.rootIds.includes(id)) return null;
  return Object.values(novel.nodes).find((n) => n.childIds.includes(id))?.id;
}

export function mergeNovels(base: Novel | undefined, local: Novel, remote: Novel): { merged: Novel; conflicts: Conflict[] } {
  const nodes: Record<string, Node> = {};
  const conflicts: Conflict[] = [];
  const ids = new Set([...Object.keys(local.nodes), ...Object.keys(remote.nodes), ...Object.keys(base?.nodes ?? {})]);

  for (const id of ids) {
    const b = base?.nodes[id];
    const l = local.nodes[id];
    const r = remote.nodes[id];
    if (l && r) {
      let chosen: Node;
      if (sameContent(l, r)) chosen = l;
      else if (b && sameContent(l, b)) chosen = r;
      else if (b && sameContent(r, b)) chosen = l;
      else {
        chosen = l;
        conflicts.push({ nodeId: id, local: l, remote: r });
      }
      nodes[id] = { ...chosen, childIds: mergeOrder(b?.childIds, l.childIds, r.childIds), updatedAt: Math.max(l.updatedAt, r.updatedAt) };
    } else if (l || r) {
      const only = (l ?? r)!;
      // 기준본에 없으면 새로 생긴 것. 기준본과 다르면 삭제보다 수정을 우선한다.
      if (!b || !sameContent(only, b)) nodes[id] = { ...only, childIds: [...only.childIds] };
    }
  }

  const rootIds = mergeOrder(base?.rootIds, local.rootIds, remote.rootIds);

  // 부모 목록에서 빠졌지만 살아남은 노드는 원래 있던 자리로 되돌린다
  const referenced = new Set([...rootIds, ...Object.values(nodes).flatMap((n) => n.childIds)]);
  for (const id of Object.keys(nodes)) {
    if (referenced.has(id)) continue;
    const source = local.nodes[id] ? local : remote;
    const parentId = parentIn(source, id);
    if (parentId === null) {
      rootIds.splice(source.rootIds.indexOf(id), 0, id);
    } else if (parentId && nodes[parentId]?.kind === 'block') {
      nodes[parentId].childIds.splice(source.nodes[parentId].childIds.indexOf(id), 0, id);
    } else continue;
    referenced.add(id);
  }

  const pick = <K extends 'title' | 'exportDocId' | 'outlineDocId'>(k: K) =>
    base && local[k] === base[k] ? remote[k] : local[k];
  const merged: Novel = {
    ...local,
    title: pick('title'),
    exportDocId: pick('exportDocId'),
    outlineDocId: pick('outlineDocId'),
    nodes,
    rootIds,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
  return { merged: normalizeTree(merged), conflicts };
}

/** 없는 id·중복 참조·씬의 자식을 정리하고, 어디에도 안 붙은 노드는 최상위 끝에 붙인다. */
export function normalizeTree(novel: Novel): Novel {
  const nodes: Record<string, Node> = {};
  const seen = new Set<string>();
  const visit = (ids: string[]): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      const n = novel.nodes[id];
      if (!n || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      nodes[id] = { ...n, childIds: [] };
      if (n.kind === 'block') nodes[id].childIds = visit(n.childIds);
    }
    return out;
  };
  const rootIds = visit(novel.rootIds);
  for (const id of Object.keys(novel.nodes)) {
    if (!seen.has(id)) rootIds.push(...visit([id]));
  }
  return { ...novel, nodes, rootIds };
}

function contentOf(n: Node): Omit<Node, 'id' | 'childIds' | 'updatedAt'> {
  const { id: _id, childIds: _c, updatedAt: _u, ...rest } = n;
  return rest;
}

export function resolveConflict(novel: Novel, c: Conflict, choice: Resolution): Novel {
  const current = novel.nodes[c.nodeId];
  if (!current) return novel;
  const now = Math.max(Date.now(), novel.updatedAt + 1);
  if (choice !== 'both') {
    const source = choice === 'local' ? c.local : c.remote;
    return { ...novel, nodes: { ...novel.nodes, [c.nodeId]: { ...current, ...contentOf(source), updatedAt: now } }, updatedAt: now };
  }
  const copyId = newId();
  const copy: Node = { ...c.remote, id: copyId, title: `${c.remote.title} (다른 기기)`, childIds: [], updatedAt: now };
  const parentId = findParentId(novel, c.nodeId);
  const list = childIdsOf(novel, parentId);
  const i = list.indexOf(c.nodeId);
  const newList = [...list.slice(0, i + 1), copyId, ...list.slice(i + 1)];
  const nodes = { ...novel.nodes, [copyId]: copy };
  if (parentId === null) return { ...novel, nodes, rootIds: newList, updatedAt: now };
  nodes[parentId] = { ...nodes[parentId], childIds: newList };
  return { ...novel, nodes, updatedAt: now };
}
