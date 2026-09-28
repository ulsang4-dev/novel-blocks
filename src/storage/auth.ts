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
