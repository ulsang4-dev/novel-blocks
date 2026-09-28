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
