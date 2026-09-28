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
