import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Novel } from '../model/types';
import type { Conflict } from '../sync/merge';

export interface SyncMeta {
  novelId: string;
  driveFileId?: string;
  remoteModified?: string;
  /** 마지막으로 드라이브와 일치했던 로컬 updatedAt. 다르면 올릴 변경이 있다. */
  syncedAt?: number;
  deleted?: boolean;
  conflicts?: Conflict[];
}

interface Schema extends DBSchema {
  novels: { key: string; value: Novel };
  bases: { key: string; value: Novel };
  meta: { key: string; value: SyncMeta };
}

export class LocalStore {
  private constructor(private db: IDBPDatabase<Schema>) {}

  static async open(name = 'novel-blocks'): Promise<LocalStore> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(d) {
        d.createObjectStore('novels', { keyPath: 'id' });
        d.createObjectStore('bases', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'novelId' });
      },
    });
    return new LocalStore(db);
  }

  listNovels(): Promise<Novel[]> {
    return this.db.getAll('novels');
  }

  getNovel(id: string): Promise<Novel | undefined> {
    return this.db.get('novels', id);
  }

  async putNovel(novel: Novel): Promise<void> {
    await this.db.put('novels', novel);
  }

  /** 저장된 작품의 updatedAt이 기대값과 같을 때만 쓴다. 병합 결과가 방금 입력한 글을 덮지 않게 한다. */
  async casNovel(novel: Novel, expectedUpdatedAt: number | undefined): Promise<boolean> {
    const tx = this.db.transaction('novels', 'readwrite');
    const current = await tx.store.get(novel.id);
    if (current?.updatedAt !== expectedUpdatedAt) {
      await tx.done;
      return false;
    }
    await tx.store.put(novel);
    await tx.done;
    return true;
  }

  /** 저장된 최신본을 읽어 바꾸고 쓰는 과정을 한 트랜잭션으로 처리한다(동기화 엔진의 쓰기와 섞이지 않게). */
  async updateNovel(id: string, fn: (stored: Novel | undefined) => Novel): Promise<Novel> {
    const tx = this.db.transaction('novels', 'readwrite');
    const next = fn(await tx.store.get(id));
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  /** 저장된 작품의 updatedAt이 기대값과 같을 때만 지운다. 방금 입력한 글이 있으면 지우지 않는다. */
  async deleteNovelIf(id: string, expectedUpdatedAt: number): Promise<boolean> {
    const tx = this.db.transaction(['novels', 'bases'], 'readwrite');
    const current = await tx.objectStore('novels').get(id);
    if (current?.updatedAt !== expectedUpdatedAt) {
      await tx.done;
      return false;
    }
    await tx.objectStore('novels').delete(id);
    await tx.objectStore('bases').delete(id);
    await tx.done;
    return true;
  }

  async deleteNovel(id: string): Promise<void> {
    await this.db.delete('novels', id);
    await this.db.delete('bases', id);
  }

  getBase(id: string): Promise<Novel | undefined> {
    return this.db.get('bases', id);
  }

  async putBase(novel: Novel): Promise<void> {
    await this.db.put('bases', novel);
  }

  listMeta(): Promise<SyncMeta[]> {
    return this.db.getAll('meta');
  }

  getMeta(id: string): Promise<SyncMeta | undefined> {
    return this.db.get('meta', id);
  }

  async putMeta(meta: SyncMeta): Promise<void> {
    await this.db.put('meta', meta);
  }

  async deleteMeta(id: string): Promise<void> {
    await this.db.delete('meta', id);
  }

  /** 작품 삭제. 드라이브에 올라간 적 있으면 다음 동기화 때 원격도 지우도록 표시를 남긴다. */
  async tombstone(id: string): Promise<void> {
    const meta = await this.getMeta(id);
    await this.deleteNovel(id);
    // remoteModified를 남겨 두어야 "삭제 뒤 다른 기기가 올린 수정"을 알아챌 수 있다
    if (meta?.driveFileId) await this.putMeta({ novelId: id, driveFileId: meta.driveFileId, remoteModified: meta.remoteModified, deleted: true });
    else await this.deleteMeta(id);
  }
}
