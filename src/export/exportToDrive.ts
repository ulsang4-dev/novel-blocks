import type { Novel } from '../model/types';
import { DriveError, type DriveApi } from '../storage/drive';
import { manuscriptHtml, outlineHtml } from './html';

export const EXPORT_FOLDER = '소설 원고';

async function upsert(drive: DriveApi, fileId: string | undefined, name: string, html: string, folderId: string) {
  try {
    return await drive.upsertGoogleDoc({ fileId, name, html, folderId });
  } catch (e) {
    // 사용자가 예전 문서를 지웠으면 새로 만든다
    if (fileId && e instanceof DriveError && e.status === 404) return drive.upsertGoogleDoc({ name, html, folderId });
    throw e;
  }
}

export async function exportNovel(
  novel: Novel,
  drive: DriveApi,
  opts: { outline: boolean },
): Promise<{ exportDocId: string; outlineDocId?: string }> {
  const folderId = await drive.ensureFolder(EXPORT_FOLDER);
  const exportDocId = await upsert(drive, novel.exportDocId, novel.title, manuscriptHtml(novel), folderId);
  const outlineDocId = opts.outline
    ? await upsert(drive, novel.outlineDocId, `${novel.title} - 플롯 개요`, outlineHtml(novel), folderId)
    : novel.outlineDocId;
  return { exportDocId, outlineDocId };
}
