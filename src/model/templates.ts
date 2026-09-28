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
