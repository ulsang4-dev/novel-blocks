import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page empty">
      <p>작품을 찾을 수 없어요.</p>
      <Link to="/">서재로 돌아가기</Link>
    </div>
  );
}
