import { describe, expect, it } from 'vitest';
import { exportNovel, EXPORT_FOLDER } from '../../src/export/exportToDrive';
import { manuscriptHtml, outlineHtml } from '../../src/export/html';
import { addNode, emptyNovel, updateNode } from '../../src/model/ops';
import { FakeDrive } from '../fakeDrive';

function novel() {
  let n = emptyNovel('나의 <소설>');
  const act = addNode(n, { parentId: null, kind: 'block', title: '1막', plot: '시작의 플롯' }); n = act.novel;
  const s1 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬1', plot: '만남' }); n = s1.novel;
  const s2 = addNode(n, { parentId: act.id, kind: 'scene', title: '씬2' }); n = s2.novel;
  const s3 = addNode(n, { parentId: act.id, kind: 'scene', title: '빈 씬' }); n = s3.novel;
  n = updateNode(n, s1.id, { body: '<p>첫 문장</p>' });
  n = updateNode(n, s2.id, { body: '<p>둘째 문장</p>' });
  return n;
}

describe('manuscriptHtml', () => {
  it('제목·덩어리 제목·본문을 순서대로 담고 씬 사이에 구분선을 넣는다', () => {
    const html = manuscriptHtml(novel());
    expect(html).toContain('<h1>나의 &lt;소설&gt;</h1>');
    expect(html).toContain('<h2>1막</h2>');
    expect(html.indexOf('첫 문장')).toBeLessThan(html.indexOf('둘째 문장'));
    expect(html.match(/\* \* \*/g)).toHaveLength(1); // 빈 씬은 건너뛴다
  });
});

describe('outlineHtml', () => {
  it('덩어리와 씬의 플롯을 담는다', () => {
    const html = outlineHtml(novel());
    expect(html).toContain('시작의 플롯');
    expect(html).toContain('<b>씬1</b>');
    expect(html).toContain('만남');
  });
});

describe('exportNovel', () => {
  it('폴더를 한 번 만들고 다시 내보내면 같은 문서를 덮어쓴다', async () => {
    const drive = new FakeDrive();
    const n = novel();
    const first = await exportNovel(n, drive, { outline: false });
    const second = await exportNovel({ ...n, ...first }, drive, { outline: true });
    expect(second.exportDocId).toBe(first.exportDocId);
    expect(second.outlineDocId).toBeTruthy();
    const folders = [...drive.files.values()].filter((f) => f.mimeType === 'folder');
    expect(folders.map((f) => f.name)).toEqual([EXPORT_FOLDER]);
  });

  it('예전 문서가 지워졌으면 새로 만든다', async () => {
    const drive = new FakeDrive();
    const out = await exportNovel({ ...novel(), exportDocId: 'gone' }, drive, { outline: false });
    expect(out.exportDocId).not.toBe('gone');
  });
});
