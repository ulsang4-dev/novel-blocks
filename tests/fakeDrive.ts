import { DriveError, type DriveApi, type DriveFile } from '../src/storage/drive';

interface FakeFile {
  name: string;
  content: string;
  modifiedTime: string;
  parents: string[];
  mimeType?: string;
}

export class FakeDrive implements DriveApi {
  files = new Map<string, FakeFile>();
  failWith: Error | null = null;
  private seq = 0;

  private tick(): string {
    this.seq++;
    return new Date(Date.UTC(2026, 0, 1) + this.seq * 1000).toISOString();
  }

  private check() {
    if (this.failWith) throw this.failWith;
  }

  private get(id: string): FakeFile {
    const f = this.files.get(id);
    if (!f) throw new DriveError(404, 'File not found');
    return f;
  }

  appFileNames(): string[] {
    return [...this.files.values()].filter((f) => f.parents.includes('appDataFolder')).map((f) => f.name).sort();
  }

  async listAppFiles(): Promise<DriveFile[]> {
    this.check();
    return [...this.files]
      .filter(([, f]) => f.parents.includes('appDataFolder'))
      .map(([id, f]) => ({ id, name: f.name, modifiedTime: f.modifiedTime }));
  }

  async getFile(fileId: string): Promise<DriveFile> {
    this.check();
    const f = this.get(fileId);
    return { id: fileId, name: f.name, modifiedTime: f.modifiedTime };
  }

  async download(fileId: string): Promise<string> {
    this.check();
    return this.get(fileId).content;
  }

  async createAppFile(name: string, content: string): Promise<DriveFile> {
    this.check();
    const id = `f${++this.seq}`;
    const modifiedTime = this.tick();
    this.files.set(id, { name, content, modifiedTime, parents: ['appDataFolder'] });
    return { id, name, modifiedTime };
  }

  async updateFile(fileId: string, content: string): Promise<DriveFile> {
    this.check();
    const f = this.get(fileId);
    f.content = content;
    f.modifiedTime = this.tick();
    return { id: fileId, name: f.name, modifiedTime: f.modifiedTime };
  }

  async deleteFile(fileId: string): Promise<void> {
    this.check();
    this.get(fileId);
    this.files.delete(fileId);
  }

  async ensureFolder(name: string): Promise<string> {
    this.check();
    for (const [id, f] of this.files) if (f.name === name && f.mimeType === 'folder') return id;
    const id = `d${++this.seq}`;
    this.files.set(id, { name, content: '', modifiedTime: this.tick(), parents: [], mimeType: 'folder' });
    return id;
  }

  async upsertGoogleDoc({ fileId, name, html, folderId }: { fileId?: string; name: string; html: string; folderId: string }): Promise<string> {
    this.check();
    if (fileId) {
      const f = this.get(fileId);
      f.name = name;
      f.content = html;
      f.modifiedTime = this.tick();
      return fileId;
    }
    const id = `g${++this.seq}`;
    this.files.set(id, { name, content: html, modifiedTime: this.tick(), parents: [folderId], mimeType: 'doc' });
    return id;
  }
}
