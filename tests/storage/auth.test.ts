import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuth } from '../../src/storage/auth';

afterEach(() => vi.unstubAllGlobals());

// 구글 로그인 스크립트(GIS)를 흉내 낸다: 요청하면 곧바로 토큰을 돌려준다
function fakeGis(expiresIn: number) {
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { callback: (r: object) => void }) => ({
            requestAccessToken: () => cfg.callback({ access_token: 'tok', expires_in: expiresIn }),
          }),
          revoke: () => {},
        },
      },
    },
  });
}

describe('GoogleAuth.state', () => {
  it('로그인 전에는 signed-out', () => {
    expect(new GoogleAuth('id').state()).toBe('signed-out');
  });

  it('유효한 토큰이면 active', async () => {
    fakeGis(3600);
    const auth = new GoogleAuth('id');
    await auth.signIn();
    expect(auth.state()).toBe('active');
  });

  it('로그인했지만 토큰이 만료되면 expired (기기에만 저장이 아니라 로그인 필요로 보여야 함)', async () => {
    fakeGis(0);
    const auth = new GoogleAuth('id');
    await auth.signIn();
    expect(auth.state()).toBe('expired');
  });

  it('로그아웃하면 다시 signed-out', async () => {
    fakeGis(3600);
    const auth = new GoogleAuth('id');
    await auth.signIn();
    auth.signOut();
    expect(auth.state()).toBe('signed-out');
  });
});
