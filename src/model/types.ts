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
