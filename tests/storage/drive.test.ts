import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveError, DriveHttp } from '../../src/storage/drive';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DriveHttp', () => {
  it('listAppFiles는 모든 페이지를 읽고 토큰을 보낸다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: '1', name: 'a', modifiedTime: 't' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json({ files: [{ id: '2', name: 'b', modifiedTime: 't' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const files = await new DriveHttp(async () => 'tok').listAppFiles();
    expect(files.map((f) => f.id)).toEqual(['1', '2']);
    expect(fetchMock.mock.calls[0][0]).toContain('spaces=appDataFolder');
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=p2');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('오류 응답은 상태 코드와 메시지를 담은 DriveError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'Storage quota exceeded' } }, 403)));
    const err = await new DriveHttp(async () => 't').download('x').catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err).toMatchObject({ status: 403, message: 'Storage quota exceeded' });
  });

  it('createAppFile은 appDataFolder에 multipart로 올린다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'n', name: 'novel-1.json', modifiedTime: 't' }));
    vi.stubGlobal('fetch', fetchMock);
    const file = await new DriveHttp(async () => 't').createAppFile('novel-1.json', '{"a":1}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(file.id).toBe('n');
    expect(url).toContain('uploadType=multipart');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    expect(init.body).toContain('"parents":["appDataFolder"]');
    expect(init.body).toContain('{"a":1}');
  });

  it('upsertGoogleDoc은 fileId가 있으면 PATCH로 덮어쓴다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'doc1' }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await new DriveHttp(async () => 't').upsertGoogleDoc({ fileId: 'doc1', name: '원고', html: '<p>x</p>', folderId: 'f' });
    expect(id).toBe('doc1');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][1].body).toContain('text/html');
  });
});
