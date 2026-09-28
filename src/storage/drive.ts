export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface DriveApi {
  listAppFiles(): Promise<DriveFile[]>;
  getFile(fileId: string): Promise<DriveFile>;
  download(fileId: string): Promise<string>;
  createAppFile(name: string, content: string): Promise<DriveFile>;
  updateFile(fileId: string, content: string): Promise<DriveFile>;
  deleteFile(fileId: string): Promise<void>;
  ensureFolder(name: string): Promise<string>;
  upsertGoogleDoc(opts: { fileId?: string; name: string; html: string; folderId: string }): Promise<string>;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,modifiedTime';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';

interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export class DriveHttp implements DriveApi {
  constructor(private getToken: () => Promise<string>) {}

  private async call(url: string, init: CallInit = {}): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json();
        message = body?.error?.message ?? message;
      } catch {
        // 본문이 JSON이 아니면 상태 문구를 쓴다
      }
      throw new DriveError(res.status, message);
    }
    return res;
  }

  private multipart(method: 'POST' | 'PATCH', url: string, metadata: object, content: string, contentType: string) {
    const boundary = `nb${Math.random().toString(36).slice(2)}`;
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return this.call(url, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }

  async listAppFiles(): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await (await this.call(`${API}/files?${params}`)).json();
      out.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    return (await this.call(`${API}/files/${fileId}?fields=${FIELDS}`)).json();
  }

  async download(fileId: string): Promise<string> {
    return (await this.call(`${API}/files/${fileId}?alt=media`)).text();
  }

  async createAppFile(name: string, content: string): Promise<DriveFile> {
    const url = `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`;
    return (await this.multipart('POST', url, { name, parents: ['appDataFolder'], mimeType: 'application/json' }, content, 'application/json')).json();
  }

  async updateFile(fileId: string, content: string): Promise<DriveFile> {
    const url = `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=${FIELDS}`;
    return (await this.multipart('PATCH', url, {}, content, 'application/json')).json();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.call(`${API}/files/${fileId}`, { method: 'DELETE' });
  }

  async ensureFolder(name: string): Promise<string> {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const found = await (await this.call(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json();
    if (found.files?.[0]) return found.files[0].id;
    const created = await (
      await this.call(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
      })
    ).json();
    return created.id;
  }

  async upsertGoogleDoc({ fileId, name, html, folderId }: { fileId?: string; name: string; html: string; folderId: string }): Promise<string> {
    if (fileId) {
      await this.multipart('PATCH', `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id`, { name }, html, 'text/html');
      return fileId;
    }
    const url = `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const created = await (await this.multipart('POST', url, { name, mimeType: DOC_MIME, parents: [folderId] }, html, 'text/html')).json();
    return created.id;
  }
}
