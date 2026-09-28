# 덩어리 — 소설 덩어리 집필 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소설을 막→장→씬 "덩어리"로 구조화하고 덩어리마다 플롯을 넣어 집필하는 개인용 PWA를 만들고, 구글 드라이브에 동기화·원고 내보내기를 한다.

**Architecture:** 서버 없는 React SPA. 모든 편집은 먼저 IndexedDB에 저장(로컬 우선)되고, `SyncEngine`이 구글 드라이브 appDataFolder의 작품별 JSON과 3-way 병합으로 동기화한다. 순수 로직(`model`, `sync/merge`, `export/html`)은 UI와 분리되어 Vitest로 검증한다.

**Tech Stack:** React 19, TypeScript, Vite, vite-plugin-pwa, react-router-dom(HashRouter), zustand, idb, @dnd-kit, TipTap v3, Vitest, fake-indexeddb, Google Identity Services, Drive REST v3.

**Spec:** `docs/superpowers/specs/2026-09-28-novel-block-writer-design.md`

## Global Constraints

- 개인용 1인 사용. 서버 없음. 정적 호스팅(GitHub Pages).
- 드라이브 권한 범위: `https://www.googleapis.com/auth/drive.appdata` + `https://www.googleapis.com/auth/drive.file` 만 사용.
- 동기화 파일명: `novel-<id>.json`, 백업 `novel-<id>.backup-<timestamp>.json`, 백업 최대 10개.
- 업로드 디바운스 3초. 앱 시작·창 포커스 복귀·온라인 복귀 시 동기화.
- 내보내기 폴더명: `소설 원고`. 재내보내기 시 기존 문서 덮어쓰기.
- 클라이언트 ID는 `VITE_GOOGLE_CLIENT_ID` 환경 변수로 주입. 없으면 앱은 "기기에만 저장" 모드로 완전 동작.
- 모바일 기준 폭 768px 미만. 좌우 여백 16px, 가로 스크롤 금지(보드 열 영역 제외).
- 템플릿 4종: `blank`, `kishotenketsu`, `three-act`, `save-the-cat`.
- UI 문구는 한국어.
- 어떤 경우에도 쓴 글이 조용히 사라지면 안 된다(삭제 vs 수정은 수정 우선, 충돌은 사용자 선택).

## Review Focus

1. 동기화 병합 결과가 도착하는 순간 사용자가 타이핑 중 → 입력이 덮어써지지 않아야 한다. (Task 4 `casNovel` 테스트, Task 9 `preferNewer` 테스트)
2. 집필 화면에서 입력 직후(400ms 이내) 다른 씬/탭으로 이동 → 마지막 입력이 저장돼야 한다. (Task 13 수동 확인 단계)
3. 사용 중 로그인 토큰 만료 → "로그인 필요" 상태가 되고 기기 저장은 계속돼야 한다. (Task 7 `AuthError` 테스트)
4. 한 기기에서 작품 삭제, 다른 기기에서 같은 작품 수정 → 수정한 쪽이 작품을 되살려야 한다. (Task 7 테스트)
5. 드라이브의 작품 JSON이 손상됨 → 기기의 내용으로 복구해야 한다. (Task 7 테스트)

---

## File Structure

```
index.html
package.json / tsconfig.json / vite.config.ts / .gitignore / .env.example
public/icon.svg (+ 생성된 PNG 아이콘들)
src/
  main.tsx
  model/
    types.ts        Novel, Node, SceneStatus, 상태 라벨
    id.ts           newId()
    text.ts         htmlToText(), charCount()
    ops.ts          트리 조작(순수 함수)
    templates.ts    TEMPLATES, createNovel()
  storage/
    local.ts        LocalStore (IndexedDB), SyncMeta
    auth.ts         GoogleAuth (GIS 토큰), AuthError
    drive.ts        DriveApi 인터페이스, DriveHttp, DriveError
  sync/
    merge.ts        mergeOrder, mergeNovels, normalizeTree, resolveConflict
    engine.ts       SyncEngine
  export/
    html.ts         manuscriptHtml, outlineHtml
    exportToDrive.ts exportNovel
  ui/
    App.tsx  store.ts  services.ts  hooks.ts  preferNewer.ts  styles.css
    components/  Header, StatusBadge, AuthBanner, ExportButton, ConflictDialog, EditableText, NotFound, SceneEditor
    screens/     Library, Board, Outline, Writer
tests/
  fakeDrive.ts
  model/ storage/ sync/ export/ ui/
docs/setup-google.md
.github/workflows/deploy.yml
```

---

### Task 1: 프로젝트 뼈대 + 텍스트 유틸

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.env.example`, `src/main.tsx`, `src/ui/App.tsx`, `src/model/types.ts`, `src/model/id.ts`, `src/model/text.ts`
- Test: `tests/model/text.test.ts`

**Interfaces:**
- Produces: `Novel`, `Node`, `NodeKind`, `SceneStatus`, `SCENE_STATUS_LABEL` (`src/model/types.ts`); `newId(): string`; `htmlToText(html: string): string`; `charCount(html?: string): number`

- [ ] **Step 1: 설정 파일 작성**

`package.json`:
```json
{
  "name": "novel-blocks",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
});
```

`index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#161514" media="(prefers-color-scheme: dark)" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
    <title>덩어리 — 소설 집필</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
dev-dist
.env.local
```

`.env.example`:
```
# Google Cloud 콘솔에서 발급한 OAuth 클라이언트 ID (docs/setup-google.md 참고)
VITE_GOOGLE_CLIENT_ID=
```

- [ ] **Step 2: 의존성 설치**

Run:
```bash
node -v   # 20 이상이어야 함
npm i react react-dom react-router-dom zustand idb @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @tiptap/react@^3 @tiptap/pm@^3 @tiptap/starter-kit@^3
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest fake-indexeddb vite-plugin-pwa
```
Expected: 설치 성공, `node_modules` 생성.

- [ ] **Step 3: 앱 진입점 작성**

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/ui/App.tsx` (Task 9에서 교체):
```tsx
export default function App() {
  return <h1>덩어리</h1>;
}
```

- [ ] **Step 4: 모델 타입과 ID**

`src/model/types.ts`:
```ts
export type NodeKind = 'block' | 'scene';
export type SceneStatus = 'idea' | 'draft' | 'revise' | 'done';

export const SCENE_STATUS_LABEL: Record<SceneStatus, string> = {
  idea: '아이디어',
  draft: '초고',
  revise: '퇴고',
  done: '완료',
};

export interface Node {
  id: string;
  kind: NodeKind; // scene은 자식을 갖지 않는다
  title: string;
  plot: string; // 이 덩어리/씬에서 일어나야 할 일
  guide?: string; // 템플릿 안내 문구
  color?: string;
  childIds: string[]; // block만 사용, 순서 보존
  characters?: string[];
  memo?: string;
  body?: string; // TipTap HTML
  status?: SceneStatus;
  updatedAt: number;
}

export interface Novel {
  id: string;
  title: string;
  templateId: string;
  rootIds: string[];
  nodes: Record<string, Node>;
  createdAt: number;
  updatedAt: number;
  exportDocId?: string;
  outlineDocId?: string;
}
```

`src/model/id.ts`:
```ts
export const newId = (): string => crypto.randomUUID();
```

- [ ] **Step 5: 실패하는 테스트 작성**

`tests/model/text.test.ts`:
```ts
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
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run tests/model/text.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/model/text"`

- [ ] **Step 7: 구현**

`src/model/text.ts`:
```ts
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function charCount(html?: string): number {
  if (!html) return 0;
  return htmlToText(html).replace(/\n/g, '').length;
}
```

- [ ] **Step 8: 테스트 통과 및 빌드 확인**

Run: `npx vitest run tests/model/text.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS, 타입 오류 없음.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React app with model types and text utils"
```

---

### Task 2: 트리 조작 (model/ops)

**Files:**
- Create: `src/model/ops.ts`
- Test: `tests/model/ops.test.ts`

**Interfaces:**
- Consumes: `Novel`, `Node`, `NodeKind` (Task 1), `newId()`
- Produces:
  - `class TreeError extends Error`
  - `type NodePatch = Partial<Pick<Node, 'title'|'plot'|'color'|'characters'|'memo'|'body'|'status'>>`
  - `stamp(prev: number): number`
  - `emptyNovel(title: string, templateId?: string): Novel`
  - `getNode(novel, id): Node`, `childIdsOf(novel, parentId: string|null): string[]`, `findParentId(novel, id): string|null`, `ancestors(novel, id): Node[]`
  - `addNode(novel, input: AddNodeInput): { novel: Novel; id: string }` — `AddNodeInput = { parentId: string|null; kind: NodeKind; title: string; index?: number; plot?: string; guide?: string }`
  - `updateNode(novel, id, patch: NodePatch): Novel`
  - `moveNode(novel, id, newParentId: string|null, index: number): Novel` — `index`는 옮긴 뒤 새 부모 목록에서의 최종 위치
  - `deleteNode(novel, id): Novel`
  - `splitBlock(novel, id, atIndex): { novel: Novel; id: string }`
  - `mergeWithNext(novel, id): Novel`
  - `orderedScenes(novel, underId?): Node[]`, `blocksAtDepth(novel, depth): Node[]`, `maxBlockDepth(novel): number`
  - `setNovelFields(novel, patch: Partial<Pick<Novel,'title'|'exportDocId'|'outlineDocId'>>): Novel`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/model/ops.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  addNode, ancestors, blocksAtDepth, deleteNode, emptyNovel, findParentId, maxBlockDepth,
  mergeWithNext, moveNode, orderedScenes, splitBlock, TreeError, updateNode,
} from '../../src/model/ops';
import type { Node } from '../../src/model/types';

function sample() {
  let n = emptyNovel('테스트');
  const a = addNode(n, { parentId: null, kind: 'block', title: '1막', plot: '시작' }); n = a.novel;
  const b = addNode(n, { parentId: null, kind: 'block', title: '2막', plot: '전개' }); n = b.novel;
  const s1 = addNode(n, { parentId: a.id, kind: 'scene', title: '씬1' }); n = s1.novel;
  const s2 = addNode(n, { parentId: a.id, kind: 'scene', title: '씬2' }); n = s2.novel;
  const s3 = addNode(n, { parentId: b.id, kind: 'scene', title: '씬3' }); n = s3.novel;
  return { n, act1: a.id, act2: b.id, s1: s1.id, s2: s2.id, s3: s3.id };
}
const titles = (nodes: Node[]) => nodes.map((x) => x.title);

describe('addNode', () => {
  it('순서대로 붙이고 부모를 기록한다', () => {
    const { n, act1, s1 } = sample();
    expect(titles(orderedScenes(n))).toEqual(['씬1', '씬2', '씬3']);
    expect(findParentId(n, s1)).toBe(act1);
  });
  it('index 위치에 끼워 넣는다', () => {
    const { n, act1 } = sample();
    const r = addNode(n, { parentId: act1, kind: 'scene', title: '씬0', index: 0 });
    expect(titles(orderedScenes(r.novel))).toEqual(['씬0', '씬1', '씬2', '씬3']);
  });
  it('씬 안에는 넣을 수 없다', () => {
    const { n, s1 } = sample();
    expect(() => addNode(n, { parentId: s1, kind: 'scene', title: 'x' })).toThrow(TreeError);
  });
  it('새 씬은 기본값을 가진다', () => {
    const { n, s1 } = sample();
    expect(n.nodes[s1]).toMatchObject({ body: '', memo: '', characters: [], status: 'idea', plot: '' });
  });
});

describe('updateNode', () => {
  it('내용을 바꾸고 수정 시각을 올린다', () => {
    const { n, s1 } = sample();
    const next = updateNode(n, s1, { plot: '만남' });
    expect(next.nodes[s1].plot).toBe('만남');
    expect(next.updatedAt).toBeGreaterThan(n.updatedAt);
    expect(n.nodes[s1].plot).toBe(''); // 원본 불변
  });
});

describe('moveNode', () => {
  it('같은 부모 안에서 최종 위치로 옮긴다', () => {
    const { n, act1, s1 } = sample();
    expect(titles(orderedScenes(moveNode(n, s1, act1, 1)))).toEqual(['씬2', '씬1', '씬3']);
  });
  it('다른 부모로 옮긴다', () => {
    const { n, act1, s3 } = sample();
    expect(titles(orderedScenes(moveNode(n, s3, act1, 0)))).toEqual(['씬3', '씬1', '씬2']);
  });
  it('자기 자손 안으로는 옮길 수 없다', () => {
    const { n, act1 } = sample();
    const sub = addNode(n, { parentId: act1, kind: 'block', title: '장' });
    expect(() => moveNode(sub.novel, act1, sub.id, 0)).toThrow(TreeError);
  });
  it('씬 안으로는 옮길 수 없다', () => {
    const { n, s1, s2 } = sample();
    expect(() => moveNode(n, s2, s1, 0)).toThrow(TreeError);
  });
});

describe('deleteNode', () => {
  it('하위 전체를 지운다', () => {
    const { n, act1, s1, s2 } = sample();
    const next = deleteNode(n, act1);
    expect(next.nodes[s1]).toBeUndefined();
    expect(next.nodes[s2]).toBeUndefined();
    expect(titles(orderedScenes(next))).toEqual(['씬3']);
  });
});

describe('splitBlock / mergeWithNext', () => {
  it('자식 목록을 기준 위치에서 둘로 나눈다', () => {
    const { n, act1, s1, s2 } = sample();
    const r = splitBlock(n, act1, 1);
    expect(r.novel.rootIds).toEqual([act1, r.id, n.rootIds[1]]);
    expect(r.novel.nodes[act1].childIds).toEqual([s1]);
    expect(r.novel.nodes[r.id].childIds).toEqual([s2]);
    expect(r.novel.nodes[r.id].title).toBe('1막 (나뉨)');
  });
  it('다음 덩어리와 합치며 플롯을 잇는다', () => {
    const { n, act1, s1, s2, s3 } = sample();
    const next = mergeWithNext(n, act1);
    expect(next.rootIds).toEqual([act1]);
    expect(next.nodes[act1].childIds).toEqual([s1, s2, s3]);
    expect(next.nodes[act1].plot).toBe('시작\n\n전개');
  });
  it('마지막 덩어리는 합칠 수 없다', () => {
    const { n, act2 } = sample();
    expect(() => mergeWithNext(n, act2)).toThrow(TreeError);
  });
});

describe('깊이와 조상', () => {
  it('덩어리 깊이와 조상을 계산한다', () => {
    const { n, act2 } = sample();
    const sub = addNode(n, { parentId: act2, kind: 'block', title: '장' });
    const sc = addNode(sub.novel, { parentId: sub.id, kind: 'scene', title: '깊은 씬' });
    expect(maxBlockDepth(sc.novel)).toBe(2);
    expect(titles(blocksAtDepth(sc.novel, 1))).toEqual(['1막', '2막']);
    expect(titles(blocksAtDepth(sc.novel, 2))).toEqual(['장']);
    expect(titles(ancestors(sc.novel, sc.id))).toEqual(['2막', '장']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/model/ops.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/model/ops"`

- [ ] **Step 3: 구현**

`src/model/ops.ts`:
```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/model/ops.test.ts`
Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/ops.ts tests/model/ops.test.ts
git commit -m "feat(model): add immutable tree operations for blocks and scenes"
```

---

### Task 3: 템플릿

**Files:**
- Create: `src/model/templates.ts`
- Test: `tests/model/templates.test.ts`

**Interfaces:**
- Consumes: `addNode`, `emptyNovel`, `TreeError` (Task 2)
- Produces: `interface Template { id; name; description; nodes: TemplateNode[] }`, `TEMPLATES: Template[]`, `createNovel(title: string, templateId: string): Novel`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/model/templates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { blocksAtDepth, TreeError } from '../../src/model/ops';
import { createNovel, TEMPLATES } from '../../src/model/templates';

describe('createNovel', () => {
  it.each([
    ['blank', 1, 0],
    ['kishotenketsu', 4, 0],
    ['three-act', 3, 7],
    ['save-the-cat', 3, 15],
  ])('%s 템플릿은 최상위 %i개, 2단계 %i개 덩어리를 만든다', (id, roots, second) => {
    const novel = createNovel('제목', id);
    expect(novel.rootIds).toHaveLength(roots);
    expect(blocksAtDepth(novel, 2)).toHaveLength(second);
    expect(novel.templateId).toBe(id);
    expect(novel.title).toBe('제목');
  });

  it('모든 덩어리에 안내 문구가 있다', () => {
    for (const t of TEMPLATES) {
      const novel = createNovel('x', t.id);
      for (const node of Object.values(novel.nodes)) expect(node.guide, `${t.id}/${node.title}`).toBeTruthy();
    }
  });

  it('없는 템플릿은 오류', () => {
    expect(() => createNovel('x', 'nope')).toThrow(TreeError);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/model/templates.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/model/templates"`

- [ ] **Step 3: 구현**

`src/model/templates.ts`:
```ts
import { addNode, emptyNovel, TreeError } from './ops';
import type { Novel } from './types';

interface TemplateNode {
  title: string;
  guide: string;
  children?: TemplateNode[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  nodes: TemplateNode[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: '빈 템플릿',
    description: '덩어리 하나에서 자유롭게 시작',
    nodes: [{ title: '1장', guide: '첫 덩어리. 자유롭게 채워 보세요.' }],
  },
  {
    id: 'kishotenketsu',
    name: '기승전결',
    description: '네 덩어리로 나누는 전통 구성',
    nodes: [
      { title: '기', guide: '인물과 배경을 소개하고 이야기의 씨앗을 심는다.' },
      { title: '승', guide: '사건이 전개되고 갈등이 커진다.' },
      { title: '전', guide: '예상을 뒤집는 전환이나 절정이 온다.' },
      { title: '결', guide: '갈등이 풀리고 여운을 남긴다.' },
    ],
  },
  {
    id: 'three-act',
    name: '3막 구조',
    description: '설정 · 대립 · 해결의 7개 덩어리',
    nodes: [
      {
        title: '1막', guide: '설정: 주인공과 세계, 그리고 이야기를 움직일 사건.',
        children: [
          { title: '설정', guide: '주인공의 일상과 결핍을 보여준다.' },
          { title: '발단', guide: '일상을 깨는 사건이 일어나고 주인공이 선택을 한다.' },
        ],
      },
      {
        title: '2막', guide: '대립: 목표를 향한 시도와 커지는 장애물.',
        children: [
          { title: '대립', guide: '주인공이 목표를 쫓고 적대 세력과 부딪힌다.' },
          { title: '중간점', guide: '판을 바꾸는 발견이나 반전. 주인공의 태도가 바뀐다.' },
          { title: '위기', guide: '모든 것을 잃은 듯한 최저점.' },
        ],
      },
      {
        title: '3막', guide: '해결: 마지막 대결과 변화의 결과.',
        children: [
          { title: '클라이맥스', guide: '주인공이 배운 것으로 최종 대결에 나선다.' },
          { title: '결말', guide: '변화한 주인공과 새로운 일상.' },
        ],
      },
    ],
  },
  {
    id: 'save-the-cat',
    name: 'Save the Cat 15비트',
    description: '블레이크 스나이더의 15개 비트',
    nodes: [
      {
        title: '1막', guide: '주인공의 세계와 변화의 계기.',
        children: [
          { title: '오프닝 이미지', guide: '변하기 전 주인공의 모습을 한 장면으로.' },
          { title: '주제 제시', guide: '누군가 이야기의 주제를 넌지시 말한다.' },
          { title: '설정', guide: '주인공의 일상, 결핍, 주변 인물.' },
          { title: '촉매', guide: '삶을 뒤흔드는 사건.' },
          { title: '토론', guide: '주인공이 망설이며 선택지를 따진다.' },
        ],
      },
      {
        title: '2막', guide: '새로운 세계에서의 시련.',
        children: [
          { title: '2막 진입', guide: '주인공이 결심하고 새로운 세계로 들어선다.' },
          { title: 'B 스토리', guide: '주제를 비추는 관계(사랑, 우정, 멘토)가 시작된다.' },
          { title: '재미와 놀이', guide: '이 이야기만의 약속된 재미를 보여준다.' },
          { title: '중간점', guide: '가짜 승리 또는 가짜 패배. 판이 커진다.' },
          { title: '다가오는 악당', guide: '안팎의 압박이 조여 온다.' },
          { title: '절망의 순간', guide: '모든 것을 잃는다.' },
          { title: '영혼의 어두운 밤', guide: '바닥에서 주인공이 깨달음을 얻는다.' },
        ],
      },
      {
        title: '3막', guide: '깨달음을 행동으로 옮긴다.',
        children: [
          { title: '3막 진입', guide: 'A와 B 스토리가 만나 해결책이 보인다.' },
          { title: '피날레', guide: '배운 것을 모두 걸고 최종 대결.' },
          { title: '파이널 이미지', guide: '오프닝 이미지와 대비되는 변화한 모습.' },
        ],
      },
    ],
  },
];

export function createNovel(title: string, templateId: string): Novel {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new TreeError(`알 수 없는 템플릿: ${templateId}`);
  let novel = emptyNovel(title, templateId);
  const build = (nodes: TemplateNode[], parentId: string | null) => {
    for (const t of nodes) {
      const added = addNode(novel, { parentId, kind: 'block', title: t.title, guide: t.guide });
      novel = added.novel;
      if (t.children) build(t.children, added.id);
    }
  };
  build(template.nodes, null);
  return novel;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/model/templates.test.ts`
Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/templates.ts tests/model/templates.test.ts
git commit -m "feat(model): add plot templates (blank, 기승전결, 3막, Save the Cat)"
```

---

### Task 4: 로컬 저장소 (IndexedDB)

**Files:**
- Create: `src/storage/local.ts`
- Test: `tests/storage/local.test.ts`

**Interfaces:**
- Consumes: `Novel` (Task 1); `Conflict` 타입은 Task 5의 `src/sync/merge.ts`에서 정의된다. 이 태스크에서는 순환을 피하려고 `import type`만 쓰므로, Task 5 전에는 다음 임시 파일을 만든다: `src/sync/merge.ts` 에 `import type { Node } from '../model/types'; export interface Conflict { nodeId: string; local: Node; remote: Node }` (Task 5에서 파일 전체를 교체하며 같은 정의를 유지).
- Produces:
  - `interface SyncMeta { novelId: string; driveFileId?: string; remoteModified?: string; syncedAt?: number; deleted?: boolean; conflicts?: Conflict[] }` — `syncedAt`은 "마지막으로 드라이브와 일치했던 로컬 `updatedAt`". `novel.updatedAt !== meta.syncedAt` 이면 올릴 게 있다는 뜻.
  - `class LocalStore` : `static open(name?)`, `listNovels()`, `getNovel(id)`, `putNovel(n)`, `casNovel(n, expectedUpdatedAt): Promise<boolean>`, `deleteNovel(id)`, `getBase(id)`, `putBase(n)`, `listMeta()`, `getMeta(id)`, `putMeta(m)`, `deleteMeta(id)`, `tombstone(id)`

- [ ] **Step 1: 임시 Conflict 타입 파일 작성**

`src/sync/merge.ts`:
```ts
import type { Node } from '../model/types';

export interface Conflict {
  nodeId: string;
  local: Node;
  remote: Node;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/storage/local.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import { LocalStore } from '../../src/storage/local';

let seq = 0;
const open = () => LocalStore.open(`local-test-${++seq}`);

describe('LocalStore', () => {
  it('작품을 저장하고 다시 읽는다', async () => {
    const store = await open();
    const novel = createNovel('하나', 'blank');
    await store.putNovel(novel);
    expect(await store.getNovel(novel.id)).toEqual(novel);
    expect(await store.listNovels()).toHaveLength(1);
  });

  it('deleteNovel은 작품과 기준본을 함께 지운다', async () => {
    const store = await open();
    const novel = createNovel('둘', 'blank');
    await store.putNovel(novel);
    await store.putBase(novel);
    await store.deleteNovel(novel.id);
    expect(await store.getNovel(novel.id)).toBeUndefined();
    expect(await store.getBase(novel.id)).toBeUndefined();
  });

  it('드라이브에 올라간 작품은 삭제 표시를 남긴다', async () => {
    const store = await open();
    const synced = createNovel('올라감', 'blank');
    const localOnly = createNovel('기기만', 'blank');
    await store.putNovel(synced);
    await store.putNovel(localOnly);
    await store.putMeta({ novelId: synced.id, driveFileId: 'f1', syncedAt: synced.updatedAt });
    await store.tombstone(synced.id);
    await store.tombstone(localOnly.id);
    expect(await store.getMeta(synced.id)).toEqual({ novelId: synced.id, driveFileId: 'f1', deleted: true });
    expect(await store.getMeta(localOnly.id)).toBeUndefined();
    expect(await store.listNovels()).toHaveLength(0);
  });

  it('casNovel은 그 사이 수정이 있었으면 덮어쓰지 않는다', async () => {
    const store = await open();
    const novel = createNovel('동시', 'blank');
    await store.putNovel(novel);
    const typed = updateNode(novel, novel.rootIds[0], { plot: '방금 입력' });
    await store.putNovel(typed); // 사용자가 병합 도중 입력
    const merged = updateNode(novel, novel.rootIds[0], { title: '병합 결과' });
    expect(await store.casNovel(merged, novel.updatedAt)).toBe(false);
    expect((await store.getNovel(novel.id))!.nodes[novel.rootIds[0]].plot).toBe('방금 입력');
    expect(await store.casNovel(merged, typed.updatedAt)).toBe(true);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/storage/local.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/storage/local"`

- [ ] **Step 4: 구현**

`src/storage/local.ts`:
```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Novel } from '../model/types';
import type { Conflict } from '../sync/merge';

export interface SyncMeta {
  novelId: string;
  driveFileId?: string;
  remoteModified?: string;
  /** 마지막으로 드라이브와 일치했던 로컬 updatedAt. 다르면 올릴 변경이 있다. */
  syncedAt?: number;
  deleted?: boolean;
  conflicts?: Conflict[];
}

interface Schema extends DBSchema {
  novels: { key: string; value: Novel };
  bases: { key: string; value: Novel };
  meta: { key: string; value: SyncMeta };
}

export class LocalStore {
  private constructor(private db: IDBPDatabase<Schema>) {}

  static async open(name = 'novel-blocks'): Promise<LocalStore> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(d) {
        d.createObjectStore('novels', { keyPath: 'id' });
        d.createObjectStore('bases', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'novelId' });
      },
    });
    return new LocalStore(db);
  }

  listNovels(): Promise<Novel[]> {
    return this.db.getAll('novels');
  }

  getNovel(id: string): Promise<Novel | undefined> {
    return this.db.get('novels', id);
  }

  async putNovel(novel: Novel): Promise<void> {
    await this.db.put('novels', novel);
  }

  /** 저장된 작품의 updatedAt이 기대값과 같을 때만 쓴다. 병합 결과가 방금 입력한 글을 덮지 않게 한다. */
  async casNovel(novel: Novel, expectedUpdatedAt: number | undefined): Promise<boolean> {
    const tx = this.db.transaction('novels', 'readwrite');
    const current = await tx.store.get(novel.id);
    if (current?.updatedAt !== expectedUpdatedAt) {
      await tx.done;
      return false;
    }
    await tx.store.put(novel);
    await tx.done;
    return true;
  }

  async deleteNovel(id: string): Promise<void> {
    await this.db.delete('novels', id);
    await this.db.delete('bases', id);
  }

  getBase(id: string): Promise<Novel | undefined> {
    return this.db.get('bases', id);
  }

  async putBase(novel: Novel): Promise<void> {
    await this.db.put('bases', novel);
  }

  listMeta(): Promise<SyncMeta[]> {
    return this.db.getAll('meta');
  }

  getMeta(id: string): Promise<SyncMeta | undefined> {
    return this.db.get('meta', id);
  }

  async putMeta(meta: SyncMeta): Promise<void> {
    await this.db.put('meta', meta);
  }

  async deleteMeta(id: string): Promise<void> {
    await this.db.delete('meta', id);
  }

  /** 작품 삭제. 드라이브에 올라간 적 있으면 다음 동기화 때 원격도 지우도록 표시를 남긴다. */
  async tombstone(id: string): Promise<void> {
    const meta = await this.getMeta(id);
    await this.deleteNovel(id);
    if (meta?.driveFileId) await this.putMeta({ novelId: id, driveFileId: meta.driveFileId, deleted: true });
    else await this.deleteMeta(id);
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/storage/local.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/local.ts src/sync/merge.ts tests/storage/local.test.ts
git commit -m "feat(storage): add IndexedDB local store with tombstones and CAS writes"
```

---

### Task 5: 3-way 병합

**Files:**
- Modify (전체 교체): `src/sync/merge.ts`
- Test: `tests/sync/merge.test.ts`

**Interfaces:**
- Consumes: `Novel`, `Node`; `newId`; `childIdsOf`, `findParentId` (Task 2)
- Produces:
  - `interface Conflict { nodeId: string; local: Node; remote: Node }` (Task 4와 동일)
  - `type Resolution = 'local' | 'remote' | 'both'`
  - `sameContent(a: Node, b: Node): boolean`
  - `mergeOrder(base: string[]|undefined, local: string[], remote: string[]): string[]`
  - `mergeNovels(base: Novel|undefined, local: Novel, remote: Novel): { merged: Novel; conflicts: Conflict[] }` — 충돌 노드는 `merged`에 로컬 버전으로 들어간다.
  - `normalizeTree(novel: Novel): Novel`
  - `resolveConflict(novel: Novel, c: Conflict, choice: Resolution): Novel`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/sync/merge.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addNode, deleteNode, emptyNovel, moveNode, updateNode } from '../../src/model/ops';
import type { Novel } from '../../src/model/types';
import { mergeNovels, mergeOrder, normalizeTree, resolveConflict } from '../../src/sync/merge';

function base() {
  let n = emptyNovel('작품');
  const act = addNode(n, { parentId: null, kind: 'block', title: '1막' }); n = act.novel;
  const act2 = addNode(n, { parentId: null, kind: 'block', title: '2막' }); n = act2.novel;
  const s1 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬1' }); n = s1.novel;
  const s2 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬2' }); n = s2.novel;
  return { n, act: act.id, act2: act2.id, s1: s1.id, s2: s2.id };
}
const occurrences = (novel: Novel, id: string) =>
  [novel.rootIds, ...Object.values(novel.nodes).map((x) => x.childIds)].flat().filter((x) => x === id).length;

describe('mergeOrder', () => {
  it('한쪽만 바뀌면 그쪽을 따른다', () => {
    expect(mergeOrder(['a', 'b'], ['b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
    expect(mergeOrder(['a', 'b'], ['a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
  });
  it('양쪽이 바뀌면 원격 순서에 로컬 새 항목을 뒤에 붙인다', () => {
    expect(mergeOrder(['a', 'b'], ['a', 'b', 'L'], ['b', 'a', 'R'])).toEqual(['b', 'a', 'R', 'L']);
  });
  it('로컬에서 뺀 항목은 빠진다', () => {
    expect(mergeOrder(['a', 'b', 'c'], ['a', 'c'], ['c', 'b', 'a', 'R'])).toEqual(['c', 'a', 'R']);
  });
});

describe('mergeNovels', () => {
  it('원격만 바뀐 씬은 원격을 따른다', () => {
    const { n, s1 } = base();
    const { merged, conflicts } = mergeNovels(n, n, updateNode(n, s1, { plot: '원격' }));
    expect(merged.nodes[s1].plot).toBe('원격');
    expect(conflicts).toEqual([]);
  });

  it('서로 다른 씬을 고치면 둘 다 반영한다', () => {
    const { n, s1, s2 } = base();
    const { merged, conflicts } = mergeNovels(n, updateNode(n, s1, { plot: '로컬' }), updateNode(n, s2, { plot: '원격' }));
    expect(merged.nodes[s1].plot).toBe('로컬');
    expect(merged.nodes[s2].plot).toBe('원격');
    expect(conflicts).toEqual([]);
  });

  it('같은 씬을 다르게 고치면 충돌이고 로컬을 유지한다', () => {
    const { n, s1 } = base();
    const { merged, conflicts } = mergeNovels(n, updateNode(n, s1, { body: '<p>A</p>' }), updateNode(n, s1, { body: '<p>B</p>' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].nodeId).toBe(s1);
    expect(conflicts[0].remote.body).toBe('<p>B</p>');
    expect(merged.nodes[s1].body).toBe('<p>A</p>');
  });

  it('같은 내용으로 고치면 충돌이 아니다', () => {
    const { n, s1 } = base();
    const { conflicts } = mergeNovels(n, updateNode(n, s1, { body: '<p>같음</p>' }), updateNode(n, s1, { body: '<p>같음</p>' }));
    expect(conflicts).toEqual([]);
  });

  it('원격에서 지웠고 로컬이 그대로면 지운다', () => {
    const { n, act, s1, s2 } = base();
    const { merged } = mergeNovels(n, n, deleteNode(n, s2));
    expect(merged.nodes[s2]).toBeUndefined();
    expect(merged.nodes[act].childIds).toEqual([s1]);
  });

  it('원격에서 지웠어도 로컬에서 고쳤으면 원래 자리에 살린다', () => {
    const { n, act, s1, s2 } = base();
    const { merged } = mergeNovels(n, updateNode(n, s2, { body: '<p>살려</p>' }), deleteNode(n, s2));
    expect(merged.nodes[s2].body).toBe('<p>살려</p>');
    expect(merged.nodes[act].childIds).toEqual([s1, s2]);
  });

  it('양쪽에서 추가한 씬은 모두 남는다', () => {
    const { n, act } = base();
    const l = addNode(n, { parentId: act, kind: 'scene', title: 'L' });
    const r = addNode(n, { parentId: act, kind: 'scene', title: 'R' });
    const { merged } = mergeNovels(n, l.novel, r.novel);
    expect(merged.nodes[act].childIds.slice(-2)).toEqual([r.id, l.id]);
  });

  it('양쪽이 다른 곳으로 옮긴 씬은 한 번만 나타난다', () => {
    const { n, act, act2, s1 } = base();
    const { merged } = mergeNovels(n, moveNode(n, s1, act2, 0), moveNode(n, s1, act, 1));
    expect(occurrences(merged, s1)).toBe(1);
  });

  it('부모가 사라진 새 씬은 최상위로 붙는다', () => {
    const { n, act2 } = base();
    const l = addNode(n, { parentId: act2, kind: 'scene', title: '고아' });
    const { merged } = mergeNovels(n, l.novel, deleteNode(n, act2));
    expect(merged.nodes[act2]).toBeUndefined();
    expect(merged.rootIds).toContain(l.id);
  });

  it('기준본이 없으면 양쪽을 합친다', () => {
    const { n, s1 } = base();
    const { merged, conflicts } = mergeNovels(undefined, n, updateNode(n, s1, { plot: '다름' }));
    expect(conflicts).toHaveLength(1);
    expect(Object.keys(merged.nodes)).toHaveLength(4);
  });

  it('작품 제목도 3-way로 합친다', () => {
    const { n } = base();
    const { merged } = mergeNovels(n, n, { ...n, title: '새 제목' });
    expect(merged.title).toBe('새 제목');
  });
});

describe('normalizeTree', () => {
  it('없는 id와 씬의 자식을 정리한다', () => {
    const { n, s1, s2 } = base();
    const broken: Novel = {
      ...n,
      rootIds: [...n.rootIds, 'ghost'],
      nodes: { ...n.nodes, [s1]: { ...n.nodes[s1], childIds: [s2] } },
    };
    const fixed = normalizeTree(broken);
    expect(fixed.rootIds).not.toContain('ghost');
    expect(fixed.nodes[s1].childIds).toEqual([]);
    expect(occurrences(fixed, s2)).toBe(1);
  });
});

describe('resolveConflict', () => {
  function conflicted() {
    const { n, act, s1 } = base();
    const { merged, conflicts } = mergeNovels(n, updateNode(n, s1, { body: '<p>A</p>' }), updateNode(n, s1, { body: '<p>B</p>' }));
    return { merged, c: conflicts[0], act, s1 };
  }
  it('local은 이 기기 내용을 남긴다', () => {
    const { merged, c, s1 } = conflicted();
    const out = resolveConflict(merged, c, 'local');
    expect(out.nodes[s1].body).toBe('<p>A</p>');
    expect(out.updatedAt).toBeGreaterThan(merged.updatedAt);
  });
  it('remote는 다른 기기 내용으로 바꾼다', () => {
    const { merged, c, s1 } = conflicted();
    expect(resolveConflict(merged, c, 'remote').nodes[s1].body).toBe('<p>B</p>');
  });
  it('both는 다른 기기 내용을 바로 뒤에 복제한다', () => {
    const { merged, c, act, s1 } = conflicted();
    const out = resolveConflict(merged, c, 'both');
    const list = out.nodes[act].childIds;
    const copyId = list[list.indexOf(s1) + 1];
    expect(out.nodes[s1].body).toBe('<p>A</p>');
    expect(out.nodes[copyId].body).toBe('<p>B</p>');
    expect(out.nodes[copyId].title).toBe('씬1 (다른 기기)');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/sync/merge.test.ts`
Expected: FAIL — `mergeOrder is not a function` 등 (export 없음)

- [ ] **Step 3: 구현 (파일 전체 교체)**

`src/sync/merge.ts`:
```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/sync/merge.test.ts`
Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/merge.ts tests/sync/merge.test.ts
git commit -m "feat(sync): add node-level 3-way merge with conflict resolution"
```

---

### Task 6: 구글 인증 + 드라이브 클라이언트 + 테스트용 가짜 드라이브

**Files:**
- Create: `src/storage/auth.ts`, `src/storage/drive.ts`, `tests/fakeDrive.ts`
- Test: `tests/storage/drive.test.ts`

**Interfaces:**
- Produces:
  - `class AuthError extends Error`; `class GoogleAuth { constructor(clientId); isSignedIn(): boolean; wasSignedIn(): boolean; onChange(fn: (signedIn: boolean) => void): () => void; getToken(): Promise<string>; signIn(): Promise<void>; trySilent(timeoutMs?): Promise<void>; signOut(): void }`
  - `interface DriveFile { id: string; name: string; modifiedTime: string }`
  - `class DriveError extends Error { status: number }`
  - `interface DriveApi { listAppFiles(); download(fileId); createAppFile(name, content); updateFile(fileId, content); deleteFile(fileId); ensureFolder(name): Promise<string>; upsertGoogleDoc(opts: { fileId?: string; name: string; html: string; folderId: string }): Promise<string> }`
  - `class DriveHttp implements DriveApi { constructor(getToken: () => Promise<string>) }`
  - `class FakeDrive implements DriveApi` (테스트 전용): `files` Map, `failWith: Error | null`, `appFileNames(): string[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/storage/drive.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveError, DriveHttp } from '../../src/storage/drive';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DriveHttp', () => {
  it('listAppFiles는 모든 페이지를 읽고 토큰을 보낸다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: '1', name: 'a', modifiedTime: 't' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json({ files: [{ id: '2', name: 'b', modifiedTime: 't' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const files = await new DriveHttp(async () => 'tok').listAppFiles();
    expect(files.map((f) => f.id)).toEqual(['1', '2']);
    expect(fetchMock.mock.calls[0][0]).toContain('spaces=appDataFolder');
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=p2');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('오류 응답은 상태 코드와 메시지를 담은 DriveError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'Storage quota exceeded' } }, 403)));
    const err = await new DriveHttp(async () => 't').download('x').catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err).toMatchObject({ status: 403, message: 'Storage quota exceeded' });
  });

  it('createAppFile은 appDataFolder에 multipart로 올린다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'n', name: 'novel-1.json', modifiedTime: 't' }));
    vi.stubGlobal('fetch', fetchMock);
    const file = await new DriveHttp(async () => 't').createAppFile('novel-1.json', '{"a":1}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(file.id).toBe('n');
    expect(url).toContain('uploadType=multipart');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    expect(init.body).toContain('"parents":["appDataFolder"]');
    expect(init.body).toContain('{"a":1}');
  });

  it('upsertGoogleDoc은 fileId가 있으면 PATCH로 덮어쓴다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'doc1' }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await new DriveHttp(async () => 't').upsertGoogleDoc({ fileId: 'doc1', name: '원고', html: '<p>x</p>', folderId: 'f' });
    expect(id).toBe('doc1');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][1].body).toContain('text/html');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/storage/drive.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/storage/drive"`

- [ ] **Step 3: 드라이브 클라이언트 구현**

`src/storage/drive.ts`:
```ts
export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface DriveApi {
  listAppFiles(): Promise<DriveFile[]>;
  download(fileId: string): Promise<string>;
  createAppFile(name: string, content: string): Promise<DriveFile>;
  updateFile(fileId: string, content: string): Promise<DriveFile>;
  deleteFile(fileId: string): Promise<void>;
  ensureFolder(name: string): Promise<string>;
  upsertGoogleDoc(opts: { fileId?: string; name: string; html: string; folderId: string }): Promise<string>;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,modifiedTime';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';

interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export class DriveHttp implements DriveApi {
  constructor(private getToken: () => Promise<string>) {}

  private async call(url: string, init: CallInit = {}): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json();
        message = body?.error?.message ?? message;
      } catch {
        // 본문이 JSON이 아니면 상태 문구를 쓴다
      }
      throw new DriveError(res.status, message);
    }
    return res;
  }

  private multipart(method: 'POST' | 'PATCH', url: string, metadata: object, content: string, contentType: string) {
    const boundary = `nb${Math.random().toString(36).slice(2)}`;
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return this.call(url, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }

  async listAppFiles(): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await (await this.call(`${API}/files?${params}`)).json();
      out.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async download(fileId: string): Promise<string> {
    return (await this.call(`${API}/files/${fileId}?alt=media`)).text();
  }

  async createAppFile(name: string, content: string): Promise<DriveFile> {
    const url = `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`;
    return (await this.multipart('POST', url, { name, parents: ['appDataFolder'], mimeType: 'application/json' }, content, 'application/json')).json();
  }

  async updateFile(fileId: string, content: string): Promise<DriveFile> {
    const url = `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=${FIELDS}`;
    return (await this.multipart('PATCH', url, {}, content, 'application/json')).json();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.call(`${API}/files/${fileId}`, { method: 'DELETE' });
  }

  async ensureFolder(name: string): Promise<string> {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const found = await (await this.call(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json();
    if (found.files?.[0]) return found.files[0].id;
    const created = await (
      await this.call(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
      })
    ).json();
    return created.id;
  }

  async upsertGoogleDoc({ fileId, name, html, folderId }: { fileId?: string; name: string; html: string; folderId: string }): Promise<string> {
    if (fileId) {
      await this.multipart('PATCH', `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id`, { name }, html, 'text/html');
      return fileId;
    }
    const url = `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const created = await (await this.multipart('POST', url, { name, mimeType: DOC_MIME, parents: [folderId] }, html, 'text/html')).json();
    return created.id;
  }
}
```

- [ ] **Step 4: 인증 구현**

`src/storage/auth.ts`:
```ts
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
const FLAG = 'novel-blocks:signed-in';

export class AuthError extends Error {}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options: { prompt: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    // 저장소가 막힌 환경(사생활 보호 모드 등)에서는 기억하지 않는다
  }
}

export class GoogleAuth {
  private token: string | null = null;
  private expiresAt = 0;
  private listeners = new Set<(signedIn: boolean) => void>();

  constructor(private clientId: string) {}

  isSignedIn(): boolean {
    return this.token !== null && Date.now() < this.expiresAt;
  }

  /** 이전에 로그인한 적이 있으면 앱 시작 시 조용히 다시 로그인을 시도한다. */
  wasSignedIn(): boolean {
    return readFlag();
  }

  onChange(fn: (signedIn: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async getToken(): Promise<string> {
    if (this.isSignedIn()) return this.token!;
    throw new AuthError('로그인이 만료됐어요');
  }

  signIn(): Promise<void> {
    return this.request();
  }

  async trySilent(timeoutMs = 8000): Promise<void> {
    await Promise.race([
      this.request(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new AuthError('timeout')), timeoutMs)),
    ]);
  }

  signOut(): void {
    if (this.token) window.google?.accounts.oauth2.revoke(this.token);
    this.token = null;
    this.expiresAt = 0;
    writeFlag(false);
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.isSignedIn());
  }

  private async load(): Promise<void> {
    if (window.google?.accounts?.oauth2) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new AuthError('구글 로그인 스크립트를 불러오지 못했어요'));
      document.head.appendChild(script);
    });
  }

  private async request(): Promise<void> {
    await this.load();
    const oauth2 = window.google!.accounts.oauth2;
    await new Promise<void>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new AuthError(response.error ?? 'no_token'));
            return;
          }
          this.token = response.access_token;
          this.expiresAt = Date.now() + (Number(response.expires_in ?? 3600) - 60) * 1000;
          writeFlag(true);
          this.emit();
          resolve();
        },
        error_callback: (error) => reject(new AuthError(error.type ?? 'popup_failed')),
      });
      client.requestAccessToken({ prompt: '' });
    });
  }
}
```

- [ ] **Step 5: 테스트용 가짜 드라이브 작성**

`tests/fakeDrive.ts`:
```ts
import { DriveError, type DriveApi, type DriveFile } from '../src/storage/drive';

interface FakeFile {
  name: string;
  content: string;
  modifiedTime: string;
  parents: string[];
  mimeType?: string;
}

export class FakeDrive implements DriveApi {
  files = new Map<string, FakeFile>();
  failWith: Error | null = null;
  private seq = 0;

  private tick(): string {
    this.seq++;
    return new Date(Date.UTC(2026, 0, 1) + this.seq * 1000).toISOString();
  }

  private check() {
    if (this.failWith) throw this.failWith;
  }

  private get(id: string): FakeFile {
    const f = this.files.get(id);
    if (!f) throw new DriveError(404, 'File not found');
    return f;
  }

  appFileNames(): string[] {
    return [...this.files.values()].filter((f) => f.parents.includes('appDataFolder')).map((f) => f.name).sort();
  }

  async listAppFiles(): Promise<DriveFile[]> {
    this.check();
    return [...this.files]
      .filter(([, f]) => f.parents.includes('appDataFolder'))
      .map(([id, f]) => ({ id, name: f.name, modifiedTime: f.modifiedTime }));
  }

  async download(fileId: string): Promise<string> {
    this.check();
    return this.get(fileId).content;
  }

  async createAppFile(name: string, content: string): Promise<DriveFile> {
    this.check();
    const id = `f${++this.seq}`;
    const modifiedTime = this.tick();
    this.files.set(id, { name, content, modifiedTime, parents: ['appDataFolder'] });
    return { id, name, modifiedTime };
  }

  async updateFile(fileId: string, content: string): Promise<DriveFile> {
    this.check();
    const f = this.get(fileId);
    f.content = content;
    f.modifiedTime = this.tick();
    return { id: fileId, name: f.name, modifiedTime: f.modifiedTime };
  }

  async deleteFile(fileId: string): Promise<void> {
    this.check();
    this.get(fileId);
    this.files.delete(fileId);
  }

  async ensureFolder(name: string): Promise<string> {
    this.check();
    for (const [id, f] of this.files) if (f.name === name && f.mimeType === 'folder') return id;
    const id = `d${++this.seq}`;
    this.files.set(id, { name, content: '', modifiedTime: this.tick(), parents: [], mimeType: 'folder' });
    return id;
  }

  async upsertGoogleDoc({ fileId, name, html, folderId }: { fileId?: string; name: string; html: string; folderId: string }): Promise<string> {
    this.check();
    if (fileId) {
      const f = this.get(fileId);
      f.name = name;
      f.content = html;
      f.modifiedTime = this.tick();
      return fileId;
    }
    const id = `g${++this.seq}`;
    this.files.set(id, { name, content: html, modifiedTime: this.tick(), parents: [folderId], mimeType: 'doc' });
    return id;
  }
}
```

- [ ] **Step 6: 테스트 통과 및 타입 확인**

Run: `npx vitest run tests/storage/drive.test.ts && npx tsc --noEmit`
Expected: 4 tests PASS, 타입 오류 없음.

- [ ] **Step 7: Commit**

```bash
git add src/storage/auth.ts src/storage/drive.ts tests/fakeDrive.ts tests/storage/drive.test.ts
git commit -m "feat(storage): add Google auth and Drive REST client"
```

---

### Task 7: 동기화 엔진

**Files:**
- Create: `src/sync/engine.ts`
- Test: `tests/sync/engine.test.ts`

**Interfaces:**
- Consumes: `LocalStore`, `SyncMeta` (Task 4), `mergeNovels`, `resolveConflict` (Task 5), `DriveApi`, `DriveFile`, `DriveError`, `AuthError` (Task 6)
- Produces:
  - `type SyncStatus = 'local-only' | 'saved' | 'syncing' | 'offline' | 'needs-login' | 'conflict' | 'error'`
  - `MAX_BACKUPS = 10`, `BACKUP_INTERVAL_MS = 600000`, `mainName(id)`, `backupName(id, ts)`, `parseNovel(text): Novel | null`, `canonical(novel): string` (노드 키 순서와 무관한 비교용 — 내용이 같으면 다시 올리지 않기 위해)
  - `interface EngineDeps { local: LocalStore; drive: DriveApi; isSignedIn: () => boolean; onStatus: (s: SyncStatus, detail?: string) => void; onChanged: (novelIds: string[]) => void; now?: () => number; debounceMs?: number }`
  - `class SyncEngine { constructor(deps); schedule(delayMs?): void; syncAll(): Promise<void>; dispose(): void }`

동작 규칙:
- 로컬 작품이 올릴 게 있다 = `novel.updatedAt !== meta.syncedAt`.
- 원격 파일의 `modifiedTime`이 `meta.remoteModified`와 같으면 원격은 그대로다 → 로컬 변경만 올린다.
- 다르면 내려받아 `mergeNovels(base, local, remote)`. 충돌이 있으면 병합본을 로컬에 저장하고 `meta.conflicts`에 기록하며 **업로드하지 않는다**(사용자가 해결한 뒤 다음 동기화에서 올림).
- 병합본 저장은 `casNovel`로 한다. 실패하면(사용자가 그 사이 입력) 이번 동기화에서 이 작품은 건너뛰고 한 번 더 돈다.
- 백업은 업로드 직전 이전 원격본으로 만들되, 가장 최근 백업이 10분 이상 지났을 때만 만든다. 최대 10개.
- 원격 JSON이 손상되면 기기 내용으로 덮어쓴다. 기기에 없는 작품이면 가장 최근의 정상 백업으로 복구한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/sync/engine.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { addNode, updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import type { Novel } from '../../src/model/types';
import { AuthError } from '../../src/storage/auth';
import { DriveError } from '../../src/storage/drive';
import { LocalStore } from '../../src/storage/local';
import { BACKUP_INTERVAL_MS, mainName, MAX_BACKUPS, SyncEngine, type SyncStatus } from '../../src/sync/engine';
import { resolveConflict } from '../../src/sync/merge';
import { FakeDrive } from '../fakeDrive';

let seq = 0;
const engines: SyncEngine[] = [];
afterEach(() => engines.splice(0).forEach((e) => e.dispose()));

async function device(drive: FakeDrive, clock = { t: Date.now() }, signedIn = true) {
  const local = await LocalStore.open(`engine-test-${++seq}`);
  const statuses: SyncStatus[] = [];
  const engine = new SyncEngine({
    local, drive, isSignedIn: () => signedIn,
    onStatus: (s) => statuses.push(s), onChanged: () => {}, now: () => clock.t,
  });
  engines.push(engine);
  return { local, engine, last: () => statuses[statuses.length - 1] };
}

async function edit(local: LocalStore, id: string, fn: (n: Novel) => Novel) {
  await local.putNovel(fn((await local.getNovel(id))!));
}

async function seeded(drive: FakeDrive) {
  const a = await device(drive);
  const b = await device(drive);
  let novel = createNovel('동기화', 'blank');
  const s1 = addNode(novel, { parentId: novel.rootIds[0], kind: 'scene', title: '씬1' }); novel = s1.novel;
  const s2 = addNode(novel, { parentId: novel.rootIds[0], kind: 'scene', title: '씬2' }); novel = s2.novel;
  await a.local.putNovel(novel);
  await a.engine.syncAll();
  await b.engine.syncAll();
  return { a, b, id: novel.id, s1: s1.id, s2: s2.id };
}

const remoteNovel = async (drive: FakeDrive, id: string): Promise<Novel> => {
  const file = (await drive.listAppFiles()).find((f) => f.name === mainName(id))!;
  return JSON.parse(await drive.download(file.id));
};

describe('SyncEngine', () => {
  it('로그인 전에는 기기에만 저장 상태', async () => {
    const d = await device(new FakeDrive(), { t: 0 }, false);
    await d.engine.syncAll();
    expect(d.last()).toBe('local-only');
  });

  it('새 작품을 올리고 다른 기기가 내려받는다', async () => {
    const drive = new FakeDrive();
    const { a, b, id } = await seeded(drive);
    expect(drive.appFileNames()).toEqual([mainName(id)]);
    expect(await b.local.getNovel(id)).toEqual(await a.local.getNovel(id));
    expect(a.last()).toBe('saved');
  });

  it('두 기기에서 서로 다른 씬을 고치면 둘 다 반영된다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1, s2 } = await seeded(drive);
    await edit(a.local, id, (n) => updateNode(n, s1, { plot: 'A가 씀' }));
    await edit(b.local, id, (n) => updateNode(n, s2, { plot: 'B가 씀' }));
    await a.engine.syncAll();
    await b.engine.syncAll();
    await a.engine.syncAll();
    for (const d of [a, b]) {
      const n = (await d.local.getNovel(id))!;
      expect(n.nodes[s1].plot).toBe('A가 씀');
      expect(n.nodes[s2].plot).toBe('B가 씀');
    }
  });

  it('같은 씬 충돌은 해결 전까지 올리지 않고, 해결하면 올린다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1 } = await seeded(drive);
    await edit(a.local, id, (n) => updateNode(n, s1, { body: '<p>A</p>' }));
    await edit(b.local, id, (n) => updateNode(n, s1, { body: '<p>B</p>' }));
    await a.engine.syncAll();
    await b.engine.syncAll();
    expect(b.last()).toBe('conflict');
    const meta = (await b.local.getMeta(id))!;
    expect(meta.conflicts).toHaveLength(1);
    expect((await remoteNovel(drive, id)).nodes[s1].body).toBe('<p>A</p>');

    const resolved = resolveConflict((await b.local.getNovel(id))!, meta.conflicts![0], 'both');
    await b.local.putNovel(resolved);
    await b.local.putMeta({ ...meta, conflicts: [] });
    await b.engine.syncAll();
    await a.engine.syncAll();
    const bodies = Object.values((await a.local.getNovel(id))!.nodes).map((x) => x.body);
    expect(bodies).toContain('<p>A</p>');
    expect(bodies).toContain('<p>B</p>');
  });

  it('한 기기에서 삭제하면 다른 기기에서도 사라진다', async () => {
    const drive = new FakeDrive();
    const { a, b, id } = await seeded(drive);
    await a.local.tombstone(id);
    await a.engine.syncAll();
    expect(drive.appFileNames()).toEqual([]);
    await b.engine.syncAll();
    expect(await b.local.getNovel(id)).toBeUndefined();
  });

  it('삭제된 작품을 다른 기기에서 고쳤다면 되살린다', async () => {
    const drive = new FakeDrive();
    const { a, b, id, s1 } = await seeded(drive);
    await a.local.tombstone(id);
    await a.engine.syncAll();
    await edit(b.local, id, (n) => updateNode(n, s1, { body: '<p>지키기</p>' }));
    await b.engine.syncAll();
    expect(drive.appFileNames()).toEqual([mainName(id)]);
    expect((await remoteNovel(drive, id)).nodes[s1].body).toBe('<p>지키기</p>');
  });

  it('원격 파일이 손상되면 기기 내용으로 복구한다', async () => {
    const drive = new FakeDrive();
    const { a, id, s1 } = await seeded(drive);
    const file = (await drive.listAppFiles()).find((f) => f.name === mainName(id))!;
    await drive.updateFile(file.id, '{깨진');
    await edit(a.local, id, (n) => updateNode(n, s1, { plot: '복구' }));
    await a.engine.syncAll();
    expect((await remoteNovel(drive, id)).nodes[s1].plot).toBe('복구');
  });

  it('백업은 10분 간격으로 만들고 최대 10개만 남긴다', async () => {
    const drive = new FakeDrive();
    const clock = { t: 1_000_000 };
    const a = await device(drive, clock);
    const novel = createNovel('백업', 'blank');
    await a.local.putNovel(novel);
    await a.engine.syncAll();
    const block = novel.rootIds[0];
    const backups = () => drive.appFileNames().filter((n) => n.includes('.backup-'));

    await edit(a.local, novel.id, (n) => updateNode(n, block, { plot: 'x1' }));
    await a.engine.syncAll();
    await edit(a.local, novel.id, (n) => updateNode(n, block, { plot: 'x2' }));
    await a.engine.syncAll();
    expect(backups()).toHaveLength(1); // 10분 안의 연속 수정은 백업 1개

    for (let i = 0; i < 12; i++) {
      clock.t += BACKUP_INTERVAL_MS;
      await edit(a.local, novel.id, (n) => updateNode(n, block, { plot: `v${i}` }));
      await a.engine.syncAll();
    }
    expect(backups()).toHaveLength(MAX_BACKUPS);
  });

  it('토큰 만료(401 또는 AuthError)는 로그인 필요 상태', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    drive.failWith = new DriveError(401, 'Invalid Credentials');
    await a.engine.syncAll();
    expect(a.last()).toBe('needs-login');
    drive.failWith = new AuthError('로그인이 만료됐어요');
    await a.engine.syncAll();
    expect(a.last()).toBe('needs-login');
  });

  it('네트워크 오류는 오프라인 상태', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    drive.failWith = new TypeError('Failed to fetch');
    await a.engine.syncAll();
    expect(a.last()).toBe('offline');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/sync/engine.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/sync/engine"`

- [ ] **Step 3: 구현**

`src/sync/engine.ts`:
```ts
import type { Novel } from '../model/types';
import { AuthError } from '../storage/auth';
import { DriveError, type DriveApi, type DriveFile } from '../storage/drive';
import type { LocalStore, SyncMeta } from '../storage/local';
import { mergeNovels } from './merge';

export type SyncStatus = 'local-only' | 'saved' | 'syncing' | 'offline' | 'needs-login' | 'conflict' | 'error';

export const MAX_BACKUPS = 10;
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const MAIN = /^novel-(.+)\.json$/;
const BACKUP = /^novel-(.+)\.backup-(\d+)\.json$/;

export const mainName = (id: string) => `novel-${id}.json`;
export const backupName = (id: string, ts: number) => `novel-${id}.backup-${ts}.json`;
const backupTime = (f: DriveFile) => Number(BACKUP.exec(f.name)?.[2] ?? 0);

/** 노드 키 순서와 무관하게 비교하기 위한 정규화 문자열 */
export function canonical(novel: Novel): string {
  const nodes = Object.fromEntries(Object.entries(novel.nodes).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ ...novel, nodes });
}

export function parseNovel(text: string): Novel | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v.id === 'string' && v.nodes && Array.isArray(v.rootIds) ? (v as Novel) : null;
  } catch {
    return null;
  }
}

export interface EngineDeps {
  local: LocalStore;
  drive: DriveApi;
  isSignedIn: () => boolean;
  onStatus: (status: SyncStatus, detail?: string) => void;
  onChanged: (novelIds: string[]) => void;
  now?: () => number;
  debounceMs?: number;
}

export class SyncEngine {
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  constructor(private d: EngineDeps) {}

  schedule(delayMs = this.d.debounceMs ?? 3000): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncAll(), delayMs);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  async syncAll(): Promise<void> {
    if (!this.d.isSignedIn()) {
      this.d.onStatus('local-only');
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.d.onStatus('syncing');
    try {
      const changed = await this.runOnce();
      this.retries = 0;
      if (changed.length) this.d.onChanged(changed);
      const metas = await this.d.local.listMeta();
      this.d.onStatus(metas.some((m) => m.conflicts?.length) ? 'conflict' : 'saved');
    } catch (e) {
      this.handleError(e);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        void this.syncAll();
      }
    }
  }

  private handleError(e: unknown) {
    if (e instanceof AuthError || (e instanceof DriveError && e.status === 401)) {
      this.d.onStatus('needs-login');
      return;
    }
    if (e instanceof DriveError && e.status === 403 && /quota|storage/i.test(e.message)) {
      this.d.onStatus('error', '드라이브 저장 공간이 부족해요. 기기에는 계속 저장돼요.');
      return;
    }
    const offline = e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
    this.d.onStatus(offline ? 'offline' : 'error', e instanceof Error ? e.message : String(e));
    this.retries++;
    this.schedule(Math.min(60_000, 1000 * 2 ** this.retries));
  }

  private async runOnce(): Promise<string[]> {
    const { local, drive } = this.d;
    const changed: string[] = [];
    const mains = new Map<string, DriveFile>();
    const backups = new Map<string, DriveFile[]>();
    for (const f of await drive.listAppFiles()) {
      const b = BACKUP.exec(f.name);
      if (b) backups.set(b[1], [...(backups.get(b[1]) ?? []), f]);
      else {
        const m = MAIN.exec(f.name);
        if (m) mains.set(m[1], f);
      }
    }
    const metas = new Map((await local.listMeta()).map((m) => [m.novelId, m]));

    // 1) 이 기기에서 지운 작품 → 드라이브에서도 지운다
    for (const meta of metas.values()) {
      if (!meta.deleted) continue;
      for (const f of [mains.get(meta.novelId), ...(backups.get(meta.novelId) ?? [])]) {
        if (f) await drive.deleteFile(f.id);
      }
      mains.delete(meta.novelId);
      metas.delete(meta.novelId);
      await local.deleteMeta(meta.novelId);
    }

    // 2) 이 기기에 있는 작품
    for (const novel of await local.listNovels()) {
      const file = mains.get(novel.id);
      mains.delete(novel.id);
      if (await this.syncOne(novel, metas.get(novel.id), file, backups.get(novel.id) ?? [])) changed.push(novel.id);
    }

    // 3) 드라이브에만 있는 작품 → 내려받는다
    for (const [id, file] of mains) {
      const remote = await this.readRemote(file, backups.get(id) ?? []);
      if (!remote) continue;
      await local.putNovel(remote);
      await local.putBase(remote);
      await local.putMeta({ novelId: id, driveFileId: file.id, remoteModified: file.modifiedTime, syncedAt: remote.updatedAt });
      changed.push(id);
    }
    return changed;
  }

  private async readRemote(file: DriveFile, backups: DriveFile[]): Promise<Novel | null> {
    const main = parseNovel(await this.d.drive.download(file.id));
    if (main) return main;
    for (const b of [...backups].sort((x, y) => backupTime(y) - backupTime(x))) {
      const restored = parseNovel(await this.d.drive.download(b.id));
      if (restored) return restored;
    }
    return null;
  }

  /** 작품 하나를 동기화한다. 기기의 작품 내용이 바뀌었으면 true. */
  private async syncOne(novel: Novel, meta: SyncMeta | undefined, file: DriveFile | undefined, backups: DriveFile[]): Promise<boolean> {
    const { local, drive } = this.d;
    const dirty = meta?.syncedAt !== novel.updatedAt;

    if (!file) {
      if (meta?.driveFileId && !dirty) {
        // 다른 기기에서 삭제했고 이 기기에서 고친 것도 없음
        await local.deleteNovel(novel.id);
        await local.deleteMeta(novel.id);
        return true;
      }
      const created = await drive.createAppFile(mainName(novel.id), JSON.stringify(novel));
      await local.putBase(novel);
      await local.putMeta({ novelId: novel.id, driveFileId: created.id, remoteModified: created.modifiedTime, syncedAt: novel.updatedAt });
      return false;
    }

    if (meta?.conflicts?.length) return false; // 사용자가 충돌을 해결할 때까지 보류

    if (meta?.remoteModified === file.modifiedTime) {
      if (dirty) await this.upload(novel, file, await local.getBase(novel.id), backups);
      return false;
    }

    const remote = parseNovel(await drive.download(file.id));
    if (!remote) {
      // 원격 파일 손상 → 이 기기 내용으로 덮어쓴다
      await this.upload(novel, file, undefined, backups);
      return false;
    }

    const { merged, conflicts } = mergeNovels(await local.getBase(novel.id), novel, remote);
    const unchangedLocally = canonical(merged) === canonical(novel);
    if (!unchangedLocally && !(await local.casNovel(merged, novel.updatedAt))) {
      this.again = true; // 병합 중 사용자가 입력함 → 다음 회차에 다시
      return false;
    }
    await local.putBase(remote);
    const next: SyncMeta = { novelId: novel.id, driveFileId: file.id, remoteModified: file.modifiedTime, syncedAt: meta?.syncedAt };

    if (conflicts.length) {
      await local.putMeta({ ...next, conflicts });
    } else if (canonical(merged) === canonical(remote)) {
      await local.putMeta({ ...next, syncedAt: merged.updatedAt });
    } else {
      await local.putMeta(next);
      await this.upload(merged, file, remote, backups);
    }
    return !unchangedLocally;
  }

  private async upload(novel: Novel, file: DriveFile, previous: Novel | undefined, backups: DriveFile[]) {
    const { local, drive } = this.d;
    const now = (this.d.now ?? Date.now)();
    const sorted = [...backups].sort((a, b) => backupTime(b) - backupTime(a));
    if (previous && (sorted.length === 0 || now - backupTime(sorted[0]) >= BACKUP_INTERVAL_MS)) {
      await drive.createAppFile(backupName(novel.id, now), JSON.stringify(previous));
      for (const old of sorted.slice(MAX_BACKUPS - 1)) await drive.deleteFile(old.id);
    }
    const updated = await drive.updateFile(file.id, JSON.stringify(novel));
    await local.putBase(novel);
    await local.putMeta({ novelId: novel.id, driveFileId: file.id, remoteModified: updated.modifiedTime, syncedAt: novel.updatedAt });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/sync/engine.test.ts`
Expected: 모든 테스트 PASS.

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: 모든 테스트 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sync/engine.ts tests/sync/engine.test.ts
git commit -m "feat(sync): add Drive sync engine with backups, tombstones and conflict hold"
```

---

### Task 8: 원고 내보내기

**Files:**
- Create: `src/export/html.ts`, `src/export/exportToDrive.ts`
- Test: `tests/export/export.test.ts`

**Interfaces:**
- Consumes: `Novel`, `DriveApi`, `DriveError`, `FakeDrive`
- Produces: `manuscriptHtml(novel): string`, `outlineHtml(novel): string`, `EXPORT_FOLDER = '소설 원고'`, `exportNovel(novel, drive, opts: { outline: boolean }): Promise<{ exportDocId: string; outlineDocId?: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/export/export.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { exportNovel, EXPORT_FOLDER } from '../../src/export/exportToDrive';
import { manuscriptHtml, outlineHtml } from '../../src/export/html';
import { addNode, emptyNovel, updateNode } from '../../src/model/ops';
import { FakeDrive } from '../fakeDrive';

function novel() {
  let n = emptyNovel('나의 <소설>');
  const act = addNode(n, { parentId: null, kind: 'block', title: '1막', plot: '시작의 플롯' }); n = act.novel;
  const s1 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬1', plot: '만남' }); n = s1.novel;
  const s2 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬2' }); n = s2.novel;
  const s3 = addNode(n, { parentId: act.id, kind: 'scene', title: '빈 씬' }); n = s3.novel;
  n = updateNode(n, s1.id, { body: '<p>첫 문장</p>' });
  n = updateNode(n, s2.id, { body: '<p>둘째 문장</p>' });
  return n;
}

describe('manuscriptHtml', () => {
  it('제목·덩어리 제목·본문을 순서대로 담고 씬 사이에 구분선을 넣는다', () => {
    const html = manuscriptHtml(novel());
    expect(html).toContain('<h1>나의 &lt;소설&gt;</h1>');
    expect(html).toContain('<h2>1막</h2>');
    expect(html.indexOf('첫 문장')).toBeLessThan(html.indexOf('둘째 문장'));
    expect(html.match(/\* \* \*/g)).toHaveLength(1); // 빈 씬은 건너뛴다
  });
});

describe('outlineHtml', () => {
  it('덩어리와 씬의 플롯을 담는다', () => {
    const html = outlineHtml(novel());
    expect(html).toContain('시작의 플롯');
    expect(html).toContain('<b>씬1</b>');
    expect(html).toContain('만남');
  });
});

describe('exportNovel', () => {
  it('폴더를 한 번 만들고 다시 내보내면 같은 문서를 덮어쓴다', async () => {
    const drive = new FakeDrive();
    const n = novel();
    const first = await exportNovel(n, drive, { outline: false });
    const second = await exportNovel({ ...n, ...first }, drive, { outline: true });
    expect(second.exportDocId).toBe(first.exportDocId);
    expect(second.outlineDocId).toBeTruthy();
    const folders = [...drive.files.values()].filter((f) => f.mimeType === 'folder');
    expect(folders.map((f) => f.name)).toEqual([EXPORT_FOLDER]);
  });

  it('예전 문서가 지워졌으면 새로 만든다', async () => {
    const drive = new FakeDrive();
    const out = await exportNovel({ ...novel(), exportDocId: 'gone' }, drive, { outline: false });
    expect(out.exportDocId).not.toBe('gone');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/export/export.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/export/exportToDrive"`

- [ ] **Step 3: 구현**

`src/export/html.ts`:
```ts
import type { Novel } from '../model/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const heading = (depth: number, text: string) => {
  const level = Math.min(depth + 1, 6);
  return `<h${level}>${esc(text)}</h${level}>`;
};
const wrap = (parts: string[]) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${parts.join('\n')}</body></html>`;
const plotParagraph = (plot: string) => `<p>${esc(plot).replace(/\n/g, '<br>')}</p>`;

export function manuscriptHtml(novel: Novel): string {
  const parts = [`<h1>${esc(novel.title)}</h1>`];
  const walk = (ids: string[], depth: number) => {
    let previousWasScene = false;
    for (const id of ids) {
      const n = novel.nodes[id];
      if (n.kind === 'block') {
        parts.push(heading(depth, n.title));
        previousWasScene = false;
        walk(n.childIds, depth + 1);
      } else if (n.body && n.body.replace(/<[^>]+>/g, '').trim()) {
        if (previousWasScene) parts.push('<p style="text-align:center">* * *</p>');
        parts.push(n.body);
        previousWasScene = true;
      }
    }
  };
  walk(novel.rootIds, 1);
  return wrap(parts);
}

export function outlineHtml(novel: Novel): string {
  const parts = [`<h1>${esc(novel.title)} — 플롯 개요</h1>`];
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      const n = novel.nodes[id];
      if (n.kind === 'block') {
        parts.push(heading(depth, n.title));
        if (n.plot) parts.push(plotParagraph(n.plot));
        walk(n.childIds, depth + 1);
      } else {
        parts.push(`<p><b>${esc(n.title)}</b></p>`);
        if (n.plot) parts.push(plotParagraph(n.plot));
      }
    }
  };
  walk(novel.rootIds, 1);
  return wrap(parts);
}
```

`src/export/exportToDrive.ts`:
```ts
import type { Novel } from '../model/types';
import { DriveError, type DriveApi } from '../storage/drive';
import { manuscriptHtml, outlineHtml } from './html';

export const EXPORT_FOLDER = '소설 원고';

async function upsert(drive: DriveApi, fileId: string | undefined, name: string, html: string, folderId: string) {
  try {
    return await drive.upsertGoogleDoc({ fileId, name, html, folderId });
  } catch (e) {
    // 사용자가 예전 문서를 지웠으면 새로 만든다
    if (fileId && e instanceof DriveError && e.status === 404) return drive.upsertGoogleDoc({ name, html, folderId });
    throw e;
  }
}

export async function exportNovel(
  novel: Novel,
  drive: DriveApi,
  opts: { outline: boolean },
): Promise<{ exportDocId: string; outlineDocId?: string }> {
  const folderId = await drive.ensureFolder(EXPORT_FOLDER);
  const exportDocId = await upsert(drive, novel.exportDocId, novel.title, manuscriptHtml(novel), folderId);
  const outlineDocId = opts.outline
    ? await upsert(drive, novel.outlineDocId, `${novel.title} - 플롯 개요`, outlineHtml(novel), folderId)
    : novel.outlineDocId;
  return { exportDocId, outlineDocId };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/export/export.test.ts`
Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export tests/export
git commit -m "feat(export): export manuscript and plot outline to Google Docs"
```

---

### Task 9: 앱 상태, 앱 셸, 공통 컴포넌트, 스타일

**Files:**
- Create: `src/ui/preferNewer.ts`, `src/ui/services.ts`, `src/ui/store.ts`, `src/ui/hooks.ts`, `src/ui/styles.css`, `src/ui/components/{Header,StatusBadge,AuthBanner,ExportButton,ConflictDialog,EditableText,NotFound}.tsx`, 임시 화면 `src/ui/screens/{Library,Board,Outline,Writer}.tsx`
- Modify: `src/ui/App.tsx`(교체), `src/main.tsx`(스타일 import)
- Test: `tests/ui/preferNewer.test.ts`

**Interfaces:**
- Consumes: 앞 태스크 전부
- Produces:
  - `preferNewer(current: Record<string, Novel>, loaded: Novel[]): Record<string, Novel>`
  - `useApp` (zustand) 상태: `ready, novels: Record<string, Novel>, status: SyncStatus, statusDetail?, signedIn, conflicts: Record<string, Conflict[]>`; 동작: `init(), reload(), create(title, templateId): Promise<string>, remove(id), update(id, fn: (n: Novel) => Novel), resolve(novelId, conflict, choice), signIn(), signOut(), exportNovel(id, withOutline): Promise<string>`
  - `type Change = (fn: (n: Novel) => Novel) => void`; `useNovel(): { novel?: Novel; change: Change }`; `useMediaQuery(q): boolean`
  - `<EditableText value onCommit placeholder? multiline? className? />` — 포커스를 잃거나(한 줄은 Enter) 할 때 저장
  - `<NotFound />`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/preferNewer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { updateNode } from '../../src/model/ops';
import { createNovel } from '../../src/model/templates';
import { preferNewer } from '../../src/ui/preferNewer';

describe('preferNewer', () => {
  it('화면에 더 최신 편집이 있으면 불러온 것보다 우선한다', () => {
    const stored = createNovel('a', 'blank');
    const typing = updateNode(stored, stored.rootIds[0], { plot: '입력 중' });
    const out = preferNewer({ [stored.id]: typing }, [stored]);
    expect(out[stored.id]).toBe(typing);
  });
  it('불러온 것이 같거나 최신이면 불러온 것을 쓰고, 사라진 작품은 뺀다', () => {
    const a = createNovel('a', 'blank');
    const gone = createNovel('gone', 'blank');
    const merged = { ...a, title: '병합됨' };
    const out = preferNewer({ [a.id]: a, [gone.id]: gone }, [merged]);
    expect(out[a.id].title).toBe('병합됨');
    expect(out[gone.id]).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/ui/preferNewer.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/ui/preferNewer"`

- [ ] **Step 3: preferNewer 구현 후 테스트 통과 확인**

`src/ui/preferNewer.ts`:
```ts
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
```

Run: `npx vitest run tests/ui/preferNewer.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 4: 서비스와 스토어 작성**

`src/ui/services.ts`:
```ts
import { AuthError, GoogleAuth } from '../storage/auth';
import { DriveHttp } from '../storage/drive';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

/** 클라이언트 ID가 없으면 null — 앱은 기기에만 저장하는 모드로 동작한다. */
export const auth = clientId ? new GoogleAuth(clientId) : null;

export const drive = new DriveHttp(() => (auth ? auth.getToken() : Promise.reject(new AuthError('구글 연동이 설정되지 않았어요'))));
```

`src/ui/store.ts`:
```ts
import { create } from 'zustand';
import { exportNovel as exportToDrive } from '../export/exportToDrive';
import { setNovelFields, TreeError } from '../model/ops';
import { createNovel } from '../model/templates';
import type { Novel } from '../model/types';
import { LocalStore } from '../storage/local';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import { resolveConflict, type Conflict, type Resolution } from '../sync/merge';
import { preferNewer } from './preferNewer';
import { auth, drive } from './services';

interface AppState {
  ready: boolean;
  novels: Record<string, Novel>;
  status: SyncStatus;
  statusDetail?: string;
  signedIn: boolean;
  conflicts: Record<string, Conflict[]>;
  init: () => Promise<void>;
  reload: () => Promise<void>;
  create: (title: string, templateId: string) => Promise<string>;
  remove: (id: string) => Promise<void>;
  update: (id: string, fn: (n: Novel) => Novel) => void;
  resolve: (novelId: string, conflict: Conflict, choice: Resolution) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => void;
  exportNovel: (id: string, withOutline: boolean) => Promise<string>;
}

let local: LocalStore;
let engine: SyncEngine;
let initPromise: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

// 로컬 저장을 순서대로 처리한다(빠른 연속 입력에서도 마지막 내용이 마지막에 저장되도록)
function queueWrite(job: () => Promise<void>): Promise<void> {
  writes = writes.then(job).catch((e) => console.error('기기 저장 실패', e));
  return writes;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  novels: {},
  status: 'local-only',
  signedIn: false,
  conflicts: {},

  init() {
    initPromise ??= (async () => {
      local = await LocalStore.open();
      engine = new SyncEngine({
        local,
        drive,
        isSignedIn: () => auth?.isSignedIn() ?? false,
        onStatus: (status, statusDetail) => set({ status, statusDetail }),
        onChanged: () => void get().reload(),
      });
      await get().reload();
      set({ ready: true });
      const kick = () => void engine.syncAll();
      window.addEventListener('focus', kick);
      window.addEventListener('online', kick);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') kick();
      });
      auth?.onChange((signedIn) => set({ signedIn }));
      if (auth?.wasSignedIn()) {
        try {
          await auth.trySilent();
          kick();
        } catch {
          set({ status: 'needs-login' });
        }
      }
    })();
    return initPromise;
  },

  async reload() {
    await writes;
    const [list, metas] = await Promise.all([local.listNovels(), local.listMeta()]);
    set((s) => ({
      novels: preferNewer(s.novels, list),
      conflicts: Object.fromEntries(metas.filter((m) => m.conflicts?.length).map((m) => [m.novelId, m.conflicts!])),
    }));
  },

  async create(title, templateId) {
    const novel = createNovel(title, templateId);
    set((s) => ({ novels: { ...s.novels, [novel.id]: novel } }));
    await queueWrite(() => local.putNovel(novel));
    engine.schedule();
    return novel.id;
  },

  async remove(id) {
    set((s) => {
      const novels = { ...s.novels };
      delete novels[id];
      return { novels };
    });
    await queueWrite(() => local.tombstone(id));
    engine.schedule();
  },

  update(id, fn) {
    const current = get().novels[id];
    if (!current) return;
    let next: Novel;
    try {
      next = fn(current);
    } catch (e) {
      if (e instanceof TreeError) {
        alert(e.message);
        return;
      }
      throw e;
    }
    if (next === current) return;
    set((s) => ({ novels: { ...s.novels, [id]: next } }));
    void queueWrite(() => local.putNovel(next));
    engine.schedule();
  },

  async resolve(novelId, conflict, choice) {
    const current = get().novels[novelId];
    if (!current) return;
    const next = resolveConflict(current, conflict, choice);
    const remaining = (get().conflicts[novelId] ?? []).filter((c) => c.nodeId !== conflict.nodeId);
    set((s) => ({ novels: { ...s.novels, [novelId]: next }, conflicts: { ...s.conflicts, [novelId]: remaining } }));
    await queueWrite(async () => {
      await local.putNovel(next);
      const meta = await local.getMeta(novelId);
      if (meta) await local.putMeta({ ...meta, conflicts: remaining });
    });
    if (remaining.length === 0) void engine.syncAll();
  },

  async signIn() {
    if (!auth) throw new Error('구글 연동이 설정되지 않았어요 (docs/setup-google.md 참고)');
    await auth.signIn();
    await engine.syncAll();
  },

  signOut() {
    auth?.signOut();
    set({ status: 'local-only' });
  },

  async exportNovel(id, withOutline) {
    const current = get().novels[id];
    if (!current) throw new Error('작품을 찾을 수 없어요');
    const ids = await exportToDrive(current, drive, { outline: withOutline });
    get().update(id, (n) => setNovelFields(n, ids));
    return ids.exportDocId;
  },
}));
```

`src/ui/hooks.ts`:
```ts
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Novel } from '../model/types';
import { useApp } from './store';

export type Change = (fn: (n: Novel) => Novel) => void;

export function useNovel(): { novel?: Novel; change: Change } {
  const { novelId } = useParams();
  const novel = useApp((s) => (novelId ? s.novels[novelId] : undefined));
  const update = useApp((s) => s.update);
  return {
    novel,
    change: (fn) => {
      if (novelId) update(novelId, fn);
    },
  };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 5: 공통 컴포넌트 작성**

`src/ui/components/EditableText.tsx`:
```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}

export default function EditableText({ value, onCommit, placeholder, multiline, className }: Props) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    focused.current = false;
    if (draft !== value) onCommit(draft);
  };

  const common = {
    value: draft,
    placeholder,
    className: `editable ${className ?? ''}`,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: commit,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
  };

  return multiline ? (
    <textarea rows={2} {...common} />
  ) : (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
```

`src/ui/components/NotFound.tsx`:
```tsx
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page empty">
      <p>작품을 찾을 수 없어요.</p>
      <Link to="/">서재로 돌아가기</Link>
    </div>
  );
}
```

`src/ui/components/StatusBadge.tsx`:
```tsx
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
```

`src/ui/components/AuthBanner.tsx`:
```tsx
import { useApp } from '../store';

export default function AuthBanner() {
  const status = useApp((s) => s.status);
  const detail = useApp((s) => s.statusDetail);
  const signIn = useApp((s) => s.signIn);
  if (status === 'needs-login') {
    return (
      <div className="banner">
        로그인이 만료됐어요. 쓴 글은 이 기기에 안전하게 저장돼 있어요.
        <button className="primary" onClick={() => void signIn().catch((e: Error) => alert(e.message))}>
          다시 로그인
        </button>
      </div>
    );
  }
  if (status === 'error' && detail) return <div className="banner banner-error">{detail}</div>;
  return null;
}
```

`src/ui/components/ExportButton.tsx`:
```tsx
import { useState } from 'react';
import { useApp } from '../store';

export default function ExportButton({ novelId }: { novelId: string }) {
  const exportNovel = useApp((s) => s.exportNovel);
  const [open, setOpen] = useState(false);
  const [outline, setOutline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await exportNovel(novelId, outline);
      setLink(`https://docs.google.com/document/d/${id}/edit`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="popover-anchor">
      <button className="ghost" onClick={() => { setOpen(!open); setLink(null); }}>
        내보내기
      </button>
      {open && (
        <div className="popover">
          <p>드라이브의 “소설 원고” 폴더에 구글 문서로 저장해요. 다시 내보내면 같은 문서를 덮어써요.</p>
          <label className="check">
            <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />
            플롯 개요 문서도 함께
          </label>
          <button className="primary" disabled={busy} onClick={() => void run()}>
            {busy ? '내보내는 중…' : '내보내기'}
          </button>
          {link && (
            <a href={link} target="_blank" rel="noreferrer">
              원고 열기 ↗
            </a>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

`src/ui/components/ConflictDialog.tsx`:
```tsx
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
```

`src/ui/components/Header.tsx`:
```tsx
import { Link, NavLink, useMatch } from 'react-router-dom';
import { auth } from '../services';
import { useApp } from '../store';
import ExportButton from './ExportButton';
import StatusBadge from './StatusBadge';

export default function Header() {
  const match = useMatch('/n/:novelId/*');
  const novelId = match?.params.novelId;
  const novel = useApp((s) => (novelId ? s.novels[novelId] : undefined));
  const signedIn = useApp((s) => s.signedIn);
  const signIn = useApp((s) => s.signIn);
  const signOut = useApp((s) => s.signOut);

  return (
    <header className="header">
      <Link to="/" className="brand">덩어리</Link>
      {novel && <span className="header-title">{novel.title}</span>}
      {novel && (
        <nav className="tabs">
          <NavLink to={`/n/${novel.id}/board`}>보드</NavLink>
          <NavLink to={`/n/${novel.id}/outline`}>목차</NavLink>
          <NavLink to={`/n/${novel.id}/write`}>집필</NavLink>
        </nav>
      )}
      <div className="header-right">
        <StatusBadge />
        {novel && signedIn && <ExportButton novelId={novel.id} />}
        {auth &&
          (signedIn ? (
            <button className="ghost" onClick={signOut}>로그아웃</button>
          ) : (
            <button className="primary" onClick={() => void signIn().catch((e: Error) => alert(`로그인 실패: ${e.message}`))}>
              구글 로그인
            </button>
          ))}
      </div>
    </header>
  );
}
```

- [ ] **Step 6: 임시 화면과 App 작성**

각 화면은 이후 태스크에서 교체한다. 지금은 라우팅 확인용.

`src/ui/screens/Library.tsx`, `Board.tsx`, `Outline.tsx`, `Writer.tsx` (이름만 바꿔 각각):
```tsx
export default function Library() {
  return <div className="page">서재</div>;
}
```

`src/ui/App.tsx`:
```tsx
import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthBanner from './components/AuthBanner';
import ConflictDialog from './components/ConflictDialog';
import Header from './components/Header';
import Board from './screens/Board';
import Library from './screens/Library';
import Outline from './screens/Outline';
import Writer from './screens/Writer';
import { useApp } from './store';

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) return <div className="splash">불러오는 중…</div>;

  return (
    <HashRouter>
      <Header />
      <AuthBanner />
      <main className="main">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/n/:novelId/board" element={<Board />} />
          <Route path="/n/:novelId/outline" element={<Outline />} />
          <Route path="/n/:novelId/write/:sceneId?" element={<Writer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ConflictDialog />
    </HashRouter>
  );
}
```

`src/main.tsx` 에 스타일 import 추가 (`import App from './ui/App';` 다음 줄):
```tsx
import './ui/styles.css';
```

- [ ] **Step 7: 스타일 작성**

`src/ui/styles.css`:
```css
:root {
  --bg: #ffffff;
  --surface: #fafaf9;
  --card: #ffffff;
  --line: #e7e5e4;
  --text: #1c1917;
  --muted: #78716c;
  --accent: #4f46e5;
  --accent-soft: #eef2ff;
  --danger: #dc2626;
  --ok: #16a34a;
  --warn: #d97706;
  --radius: 10px;
  --font-ui: 'Pretendard', system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif;
  --font-body: 'Noto Serif KR', 'AppleMyungjo', serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161514;
    --surface: #1d1c1a;
    --card: #232220;
    --line: #34322f;
    --text: #ecebe9;
    --muted: #a19d97;
    --accent: #8b8cf8;
    --accent-soft: #25254a;
    color-scheme: dark;
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font-ui); font-size: 15px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
button, select, input, textarea { font: inherit; color: inherit; }
button { border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--muted); }
button:disabled { opacity: 0.4; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.ghost { background: transparent; border-color: transparent; color: var(--muted); }
button.ghost:hover:not(:disabled) { color: var(--text); background: var(--surface); }
.danger { color: var(--danger) !important; }
.muted { color: var(--muted); }
.error { color: var(--danger); }
select { border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 5px 8px; }
.splash, .empty { padding: 48px 16px; text-align: center; color: var(--muted); }
.empty a { color: var(--accent); }

/* 헤더 */
.header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 16px; height: 56px; padding: 0 20px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.brand { font-weight: 700; letter-spacing: -0.02em; }
.header-title { color: var(--muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabs { display: flex; gap: 4px; }
.tabs a { padding: 6px 12px; border-radius: 8px; color: var(--muted); }
.tabs a.active { color: var(--text); background: var(--surface); }
.header-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.badge { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: var(--surface); color: var(--muted); white-space: nowrap; }
.badge-saved { color: var(--ok); }
.badge-syncing { color: var(--accent); }
.badge-needs-login, .badge-conflict, .badge-error { color: var(--danger); }
.banner { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; padding: 10px 16px; background: var(--accent-soft); font-size: 14px; }
.banner-error { background: color-mix(in srgb, var(--danger) 12%, var(--bg)); }
.main { min-height: calc(100vh - 56px); }
.page { max-width: 880px; margin: 0 auto; padding: 32px 20px 96px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
.page-head h1 { font-size: 22px; margin: 0; }

/* 제자리 편집 */
.editable { width: 100%; border: 1px solid transparent; border-radius: 6px; background: transparent; padding: 4px 6px; resize: none; field-sizing: content; }
.editable:hover { border-color: var(--line); }
.editable:focus { outline: none; border-color: var(--accent); background: var(--card); }
.editable::placeholder { color: var(--muted); opacity: 0.7; }

/* 서재 */
.new-novel { display: grid; gap: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.new-novel > input { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); font-size: 16px; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.template { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); cursor: pointer; }
.template input { position: absolute; opacity: 0; pointer-events: none; }
.template span { font-size: 13px; color: var(--muted); }
.template.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.new-novel > button { justify-self: end; }
.novel-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.novel-item { display: flex; align-items: center; padding-right: 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); }
.novel-item a { flex: 1; min-width: 0; display: grid; gap: 2px; padding: 16px 18px; }
.novel-item .muted { font-size: 13px; }

/* 보드 */
.board { padding: 20px 20px 96px; }
.board-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 14px; }
.columns { display: flex; gap: 14px; align-items: flex-start; overflow-x: auto; padding-bottom: 12px; }
.column { flex: 0 0 280px; display: grid; gap: 10px; padding: 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.column.over { border-color: var(--accent); }
.column-title { font-weight: 600; }
.plot { font-size: 13px; color: var(--muted); }
.cards { display: grid; gap: 8px; min-height: 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; display: grid; gap: 4px; }
.card.dragging { opacity: 0.5; }
.card-top { display: flex; align-items: center; gap: 2px; }
.handle { cursor: grab; color: var(--muted); padding: 4px; touch-action: none; user-select: none; }
.card-foot { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); padding: 0 6px; }
.card-foot a { color: var(--accent); }
.card-foot select { font-size: 12px; padding: 2px 4px; margin-left: auto; max-width: 90px; }
.chip { padding: 1px 7px; border-radius: 999px; background: var(--surface); }
.chip-draft { color: var(--accent); }
.chip-revise { color: var(--warn); }
.chip-done { color: var(--ok); }
.add { justify-self: start; }
.add-column { flex: 0 0 auto; align-self: flex-start; }

/* 목차 */
.tree { list-style: none; margin: 0; padding: 0 0 0 20px; }
.page > .tree { padding-left: 0; }
.tree-row { display: flex; align-items: flex-start; gap: 4px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.tree-toggle { flex: 0 0 24px; padding: 6px 0; border: none; background: none; color: var(--muted); text-align: center; }
.tree-body { flex: 1; min-width: 0; }
.tree-body > input { font-weight: 600; }
.tree-meta { font-size: 12px; color: var(--muted); padding: 0 6px; }
.tree-meta a { color: var(--accent); }
.row-menu { position: relative; }
.row-menu summary { list-style: none; cursor: pointer; padding: 4px 10px; color: var(--muted); border-radius: 6px; }
.row-menu summary::-webkit-details-marker { display: none; }
.row-menu summary:hover { background: var(--surface); }
.menu { position: absolute; right: 0; z-index: 5; display: grid; min-width: 190px; padding: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.08); }
.menu button { text-align: left; border: none; background: none; padding: 7px 10px; }
.menu button:hover:not(:disabled) { background: var(--surface); }

/* 집필 */
.writer { display: grid; grid-template-columns: 300px 1fr; min-height: calc(100vh - 56px); }
.writer-side { border-right: 1px solid var(--line); background: var(--surface); padding: 20px; }
.writer-side summary { font-weight: 600; cursor: pointer; }
.writer-side details[open] summary { margin-bottom: 12px; }
.writer-side label { display: grid; gap: 4px; margin-top: 14px; font-size: 13px; color: var(--muted); }
.writer-side label .editable, .writer-side select { color: var(--text); background: var(--card); border-color: var(--line); }
.ancestor { margin-bottom: 10px; font-size: 13px; }
.ancestor p { margin: 2px 0 0; white-space: pre-wrap; }
.writer-main { max-width: 760px; width: 100%; margin: 0 auto; padding: 32px 24px 96px; display: flex; flex-direction: column; }
.scene-title { font-size: 22px; font-weight: 600; margin-bottom: 12px; }
.editor { flex: 1; }
.editor .tiptap { min-height: 60vh; outline: none; font-family: var(--font-body); font-size: 17px; line-height: 1.9; padding: 0 6px; }
.editor .tiptap p { margin: 0 0 0.9em; }
.writer-foot { display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid var(--line); }

/* 팝오버·모달 */
.popover-anchor { position: relative; }
.popover { position: absolute; right: 0; top: calc(100% + 8px); width: 260px; display: grid; gap: 10px; padding: 14px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 12px 32px rgb(0 0 0 / 0.1); font-size: 14px; z-index: 30; }
.popover p { margin: 0; }
.popover a { color: var(--accent); }
.check { display: flex; gap: 8px; align-items: center; }
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgb(0 0 0 / 0.35); }
.modal { width: min(760px, 100%); max-height: 90vh; overflow: auto; background: var(--bg); border-radius: 14px; padding: 22px; }
.modal h3 { margin: 0 0 4px; }
.conflict-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
.conflict-side { border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
.conflict-side h4 { margin: 0 0 6px; font-size: 13px; color: var(--muted); }
.conflict-name { font-weight: 600; margin: 0 0 4px; }
.conflict-body { font-family: var(--font-body); white-space: pre-wrap; max-height: 40vh; overflow: auto; font-size: 14px; }
.modal-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }

/* 휴대폰 */
@media (max-width: 767px) {
  input, textarea, select { font-size: 16px; } /* iOS 자동 확대 방지 */
  .header { gap: 10px; padding: 0 16px; }
  .header-title { display: none; }
  .tabs { position: fixed; bottom: 0; left: 0; right: 0; z-index: 20; justify-content: space-around; padding: 6px 8px calc(6px + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--line); }
  .tabs a { flex: 1; text-align: center; padding: 8px; }
  .page { padding: 20px 16px 96px; }
  .board { padding: 16px 0 96px; }
  .board-bar { padding: 0 16px; }
  .columns { scroll-snap-type: x mandatory; padding: 0 16px 12px; scroll-padding: 0 16px; }
  .column { flex: 0 0 calc(100vw - 48px); scroll-snap-align: start; }
  .writer { grid-template-columns: 1fr; }
  .writer-side { border-right: none; border-bottom: 1px solid var(--line); padding: 12px 16px; }
  .writer-main { padding: 20px 16px 96px; }
  .conflict-grid { grid-template-columns: 1fr; }
  .popover { position: fixed; left: 16px; right: 16px; top: 64px; width: auto; }
}
```

- [ ] **Step 8: 실행 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 오류 없음, 모든 테스트 PASS.

Run: `npm run dev` 를 백그라운드로 띄우고 브라우저로 `http://localhost:5173` 접속.
Expected: 헤더에 "덩어리"와 "기기에만 저장" 배지, 본문에 "서재". `.env.local`이 없으므로 로그인 버튼은 보이지 않는다.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): add app store, shell, sync status, conflict dialog and styles"
```

---

### Task 10: 서재 화면

**Files:**
- Modify (교체): `src/ui/screens/Library.tsx`

**Interfaces:**
- Consumes: `useApp` (`novels`, `create`, `remove`), `TEMPLATES`, `orderedScenes`, `charCount`

- [ ] **Step 1: 구현**

`src/ui/screens/Library.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { orderedScenes } from '../../model/ops';
import { TEMPLATES } from '../../model/templates';
import { charCount } from '../../model/text';
import type { Novel } from '../../model/types';
import { useApp } from '../store';

const totalChars = (n: Novel) => orderedScenes(n).reduce((sum, s) => sum + charCount(s.body), 0);

export default function Library() {
  const novels = useApp((s) => s.novels);
  const create = useApp((s) => s.create);
  const remove = useApp((s) => s.remove);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('three-act');
  const list = Object.values(novels).sort((a, b) => b.updatedAt - a.updatedAt);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = await create(title.trim() || '제목 없는 소설', templateId);
    navigate(`/n/${id}/board`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>서재</h1>
        <button className="primary" onClick={() => setCreating(!creating)}>
          {creating ? '닫기' : '새 작품'}
        </button>
      </div>

      {creating && (
        <form className="new-novel" onSubmit={(e) => void submit(e)}>
          <input autoFocus placeholder="작품 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="template-grid" role="radiogroup" aria-label="플롯 템플릿">
            {TEMPLATES.map((t) => (
              <label key={t.id} className={`template ${templateId === t.id ? 'selected' : ''}`}>
                <input type="radio" name="template" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </label>
            ))}
          </div>
          <button className="primary" type="submit">만들기</button>
        </form>
      )}

      {list.length === 0 && !creating && <p className="empty">아직 작품이 없어요. “새 작품”으로 시작해 보세요.</p>}

      <ul className="novel-list">
        {list.map((n) => (
          <li key={n.id} className="novel-item">
            <Link to={`/n/${n.id}/board`}>
              <strong>{n.title}</strong>
              <span className="muted">
                {totalChars(n).toLocaleString()}자 · {new Date(n.updatedAt).toLocaleDateString('ko-KR')} 수정
              </span>
            </Link>
            <button
              className="ghost danger"
              onClick={() => {
                if (confirm(`“${n.title}”을(를) 삭제할까요? 드라이브에서도 지워져요.`)) void remove(n.id);
              }}
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: 브라우저 확인**

`npm run dev` 상태에서 `http://localhost:5173` 접속:
- "새 작품" → 제목 입력, "3막 구조" 선택, "만들기" → `#/n/<id>/board`로 이동.
- 헤더 "덩어리" 클릭 → 서재에 작품이 "0자 · 오늘 날짜 수정"으로 보임.
- 새로고침해도 작품이 남아 있음(IndexedDB).
- "삭제" → 확인 → 목록에서 사라짐.
- 폭 375px(모바일)에서 가로 스크롤 없음.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/Library.tsx
git commit -m "feat(ui): add library screen with template picker"
```

---

### Task 11: 목차 화면

**Files:**
- Create: `src/ui/colors.ts`
- Modify (교체): `src/ui/screens/Outline.tsx`
- Modify: `src/ui/styles.css` (색상 견본 스타일 추가)

**Interfaces:**
- Consumes: `useNovel`, `Change`; `addNode, updateNode, moveNode, deleteNode, splitBlock, mergeWithNext, findParentId, childIdsOf` (Task 2); `EditableText`, `NotFound`; `SCENE_STATUS_LABEL`, `charCount`
- Produces: `LABEL_COLORS: string[]` (`src/ui/colors.ts`) — Task 12 보드에서도 `node.color`를 표시한다.

- [ ] **Step 0: 색상 라벨 정의와 스타일**

`src/ui/colors.ts`:
```ts
export const LABEL_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
```

`src/ui/styles.css` 의 `/* 목차 */` 구역 끝에 추가:
```css
.swatches { display: flex; gap: 6px; padding: 6px 10px; }
.swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 1px solid var(--line); }
.swatch.none { background: var(--card); font-size: 11px; line-height: 1; color: var(--muted); }
```

- [ ] **Step 1: 구현**

`src/ui/screens/Outline.tsx`:
```tsx
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
```

- [ ] **Step 2: 브라우저 확인**

3막 구조 작품의 `#/n/<id>/outline` 에서:
- 1막 ▾ 아래 설정·발단이 보이고, 플롯 칸에 안내 문구가 placeholder로 보임.
- "설정" 메뉴 → "+ 씬 추가" → 새 씬 생김. 씬 제목 수정 후 Enter → 새로고침해도 유지.
- 씬 "위로/아래로", "들여쓰기/내어쓰기"가 기대대로 동작. 불가능한 항목은 비활성.
- "발단" 행 메뉴 "여기서 덩어리 나누기" → 1막 뒤에 "1막 (나뉨)"이 생기고 발단이 그 안으로.
- "1막" 메뉴 "다음 덩어리와 합치기" → 다시 하나로 합쳐짐.
- 삭제 확인창 → 하위까지 삭제.
- 메뉴의 색상 견본을 누르면 행 왼쪽에 색 띠가 생기고, 보드의 해당 열/카드에도 같은 색이 보임. "×"로 해제.
- 모바일 폭에서 메뉴가 화면 밖으로 넘치지 않음.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/Outline.tsx
git commit -m "feat(ui): add outline tree with move, split and merge actions"
```

---

### Task 12: 구조 보드 화면

**Files:**
- Modify (교체): `src/ui/screens/Board.tsx`

**Interfaces:**
- Consumes: `useNovel`, `Change`; `blocksAtDepth, maxBlockDepth, orderedScenes, moveNode, findParentId, childIdsOf, getNode, addNode, updateNode, deleteNode` (Task 2); `EditableText`, `NotFound`; `@dnd-kit/*`

규칙: 열 = 선택한 단계의 덩어리. 카드 = 그 덩어리 아래 모든 씬(순서대로). 카드를 다른 카드 위에 놓으면 그 카드의 부모에 그 카드 자리로, 열의 빈 곳에 놓으면 그 열 덩어리의 마지막 자식으로 옮긴다. 휴대폰에서는 카드의 "옮기기" 선택 상자로도 옮길 수 있다.

- [ ] **Step 1: 구현**

`src/ui/screens/Board.tsx`:
```tsx
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
```

- [ ] **Step 2: 브라우저 확인**

3막 구조 작품의 `#/n/<id>/board`:
- 기본으로 2단계(설정·발단·대립…) 7개 열. "열 기준"을 1단계로 바꾸면 1막·2막·3막 3개 열.
- 각 열 "+ 씬"으로 씬 추가, 카드 제목과 플롯 수정이 유지됨.
- 데스크톱: 손잡이(⋮⋮)로 카드를 같은 열 안에서 순서 변경, 다른 열로 이동. 빈 열로도 이동 가능.
- "옮기기" 선택 상자로 다른 열에 이동.
- 모바일 폭(375px): 열이 한 화면에 하나씩, 좌우로 넘기면 딱 맞춰 멈춤. 손잡이를 길게 눌러 끌기 가능.
- 목차 화면과 내용이 일치.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/Board.tsx
git commit -m "feat(ui): add drag-and-drop structure board"
```

---

### Task 13: 집필 화면

**Files:**
- Create: `src/ui/components/SceneEditor.tsx`
- Modify (교체): `src/ui/screens/Writer.tsx`

**Interfaces:**
- Consumes: `useNovel`, `useMediaQuery`; `orderedScenes, ancestors, updateNode`; `charCount`; `SCENE_STATUS_LABEL`, `SceneStatus`; `EditableText`, `NotFound`; TipTap v3
- Produces: `<SceneEditor html onChange />` — 400ms 디바운스, 포커스 해제·언마운트 시 즉시 저장

- [ ] **Step 1: 편집기 컴포넌트 구현**

`src/ui/components/SceneEditor.tsx`:
```tsx
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

interface Props {
  html: string;
  onChange: (html: string) => void;
}

export default function SceneEditor({ html, onChange }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) {
      onChangeRef.current(pending.current);
      pending.current = null;
    }
  };

  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    onUpdate: ({ editor: e }) => {
      pending.current = e.getHTML();
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    },
    onBlur: () => flush(),
  });

  // 씬 이동·화면 전환 직전의 입력도 저장한다
  useEffect(() => () => flush(), []);

  // 다른 기기에서 동기화된 본문을 반영한다(입력 중이 아닐 때만)
  useEffect(() => {
    if (editor && !editor.isFocused && pending.current === null && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [html, editor]);

  return <EditorContent editor={editor} className="editor" />;
}
```

- [ ] **Step 2: 집필 화면 구현**

`src/ui/screens/Writer.tsx`:
```tsx
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
```

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음. (TipTap이 v2로 설치됐다면 `setContent(html, { emitUpdate: false })`를 `setContent(html, false)`로 바꾼다 — `npm ls @tiptap/react`로 버전 확인.)

- [ ] **Step 4: 브라우저 확인 (Review Focus 2 포함)**

- 보드 카드의 "쓰기 →" → 집필 화면. 왼쪽에 상위 덩어리(예: 1막, 설정)의 플롯/안내 문구와 씬 플롯이 보임.
- 본문 입력 → 글자 수가 바뀜 → 새로고침해도 본문 유지.
- **본문을 입력하고 바로(0.4초 안에) "다음 씬 →"을 누른 뒤 "← 이전 씬"으로 돌아오면 마지막 글자까지 남아 있음.**
- **본문을 입력하고 바로 헤더의 "보드" 탭으로 이동해도 카드의 글자 수에 반영됨.**
- 상태를 "초고"로 바꾸면 보드 카드 칩이 바뀜.
- 모바일 폭: 상단에 "플롯 · 메모" 접힘 영역, 누르면 펼쳐짐. 본문 서체가 명조.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/SceneEditor.tsx src/ui/screens/Writer.tsx
git commit -m "feat(ui): add writing screen with plot side panel and TipTap editor"
```

---

### Task 14: PWA, 구글 설정 안내, 배포 워크플로

**Files:**
- Create: `public/icon.svg`, `docs/setup-google.md`, `.github/workflows/deploy.yml`, 아이콘 PNG들(생성)
- Modify: `vite.config.ts`, `index.html`

- [ ] **Step 1: 아이콘 작성 및 생성**

`public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#4f46e5"/>
  <rect x="112" y="128" width="128" height="112" rx="20" fill="#fff"/>
  <rect x="272" y="128" width="128" height="176" rx="20" fill="#fff" opacity=".8"/>
  <rect x="112" y="272" width="128" height="112" rx="20" fill="#fff" opacity=".8"/>
  <rect x="272" y="336" width="128" height="48" rx="20" fill="#fff" opacity=".6"/>
</svg>
```

Run: `npx @vite-pwa/assets-generator --preset minimal-2023 public/icon.svg`
Expected: `public/`에 `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico` 생성.

- [ ] **Step 2: PWA 설정**

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: '덩어리 — 소설 집필',
        short_name: '덩어리',
        description: '소설을 덩어리로 나누고 플롯을 채워 쓰는 집필 앱',
        lang: 'ko',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com' || url.origin === 'https://cdn.jsdelivr.net',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
```

`index.html` 의 `<title>` 위에 추가:
```html
    <link rel="icon" href="favicon.ico" sizes="48x48" />
    <link rel="icon" href="icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="apple-touch-icon-180x180.png" />
```

- [ ] **Step 3: 빌드와 오프라인 확인**

Run: `npm run build && npm run preview`
Expected: 빌드 성공, `dist/sw.js`와 `dist/manifest.webmanifest` 생성.
브라우저로 preview 주소 접속 → 개발자 도구에서 오프라인 전환 후 새로고침 → 앱이 뜨고 작품 편집 가능, 배지 "기기에만 저장".

- [ ] **Step 4: 구글 설정 안내 문서 작성**

`docs/setup-google.md`:
````markdown
# 구글 드라이브 연결하기 (한 번만, 약 10분)

## 1. Google Cloud 프로젝트 만들기
1. https://console.cloud.google.com 에 접속해 로그인합니다.
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 `덩어리` → 만들기.

## 2. Drive API 켜기
1. 왼쪽 메뉴 **API 및 서비스 → 라이브러리**.
2. `Google Drive API` 검색 → **사용**.

## 3. OAuth 동의 화면
1. **API 및 서비스 → OAuth 동의 화면**(또는 "Google 인증 플랫폼").
2. 사용자 유형 **외부** → 앱 이름 `덩어리`, 지원 이메일에 본인 메일.
3. **데이터 액세스(범위)** 에서 다음 두 개를 추가:
   - `.../auth/drive.appdata`
   - `.../auth/drive.file`
4. **대상(테스트 사용자)** 에 본인 구글 계정을 추가합니다. 게시 상태는 **테스트**로 둡니다(심사 불필요).

## 4. OAuth 클라이언트 ID 만들기
1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**.
2. 애플리케이션 유형 **웹 애플리케이션**.
3. **승인된 자바스크립트 원본**에 추가:
   - `http://localhost:5173`
   - `http://localhost:4173`
   - 배포 주소 (예: `https://<GitHub아이디>.github.io`)
4. 만들기 → 표시된 **클라이언트 ID**(`...apps.googleusercontent.com`)를 복사합니다.

## 5. 앱에 넣기
- 내 컴퓨터에서 실행할 때: 프로젝트 폴더에 `.env.local` 파일을 만들고
  ```
  VITE_GOOGLE_CLIENT_ID=복사한_클라이언트_ID
  ```
- GitHub Pages 배포: 저장소 **Settings → Secrets and variables → Actions → Variables** 에
  `VITE_GOOGLE_CLIENT_ID` 변수를 추가합니다.

## 참고
- 테스트 상태의 앱은 로그인할 때 "Google에서 확인하지 않은 앱" 경고가 나옵니다. 본인이 만든 앱이므로 **계속**을 누르면 됩니다.
- 로그인은 약 1시간마다 만료됩니다. 만료되면 상단에 "다시 로그인" 배너가 나오고, 그동안 쓴 글은 기기에 저장돼 있다가 로그인하면 올라갑니다.
- 앱은 드라이브의 앱 전용 숨김 폴더와 앱이 만든 “소설 원고” 폴더에만 접근합니다.
````

- [ ] **Step 5: 배포 워크플로 작성**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}
          VITE_BASE: /${{ github.event.repository.name }}/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: 최종 확인**

Run: `npm test && npm run build`
Expected: 모든 테스트 PASS, 빌드 성공.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add PWA manifest, Google setup guide and Pages deploy workflow"
```

- [ ] **Step 8: 사용자와 함께 하는 연결 (사용자 확인 필요)**

에이전트가 혼자 하지 않는다. 사용자에게 다음을 안내하고, 사용자가 원할 때만 진행한다:
1. `docs/setup-google.md` 1~5단계로 클라이언트 ID 발급 → `.env.local` 작성.
2. `npm run dev` → "구글 로그인" → 작품 편집 → 배지가 "저장됨"으로 바뀌는지, 다른 브라우저(또는 폰)에서 같은 작품이 보이는지 확인.
3. "내보내기" → 드라이브 “소설 원고” 폴더에 구글 문서가 생기는지 확인.
4. GitHub 저장소 생성과 push(외부 게시이므로 사용자 승인 후), Pages 설정에서 Source를 **GitHub Actions**로 지정, 배포 주소를 클라이언트 ID의 승인된 원본에 추가.
5. 폰에서 배포 주소 접속 → 공유 메뉴 → "홈 화면에 추가".
