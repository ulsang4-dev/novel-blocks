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
