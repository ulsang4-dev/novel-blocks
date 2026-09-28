import { AuthError, GoogleAuth } from '../storage/auth';
import { DriveHttp } from '../storage/drive';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

/** 클라이언트 ID가 없으면 null — 앱은 기기에만 저장하는 모드로 동작한다. */
export const auth = clientId ? new GoogleAuth(clientId) : null;

export const drive = new DriveHttp(() => (auth ? auth.getToken() : Promise.reject(new AuthError('구글 연동이 설정되지 않았어요'))));
