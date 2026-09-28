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
