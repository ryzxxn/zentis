import type { IMemoryStorage, MemoryItem } from '../../types.js';

/**
 * IndexedDB implementation of Zentis Memory Storage
 * Uses the browser's native IndexedDB API
 */
export class IndexedDBStorage implements IMemoryStorage {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;

  constructor(dbName: string = 'zentis_db', storeName: string = 'history') {
    if (typeof window === 'undefined') {
      throw new Error('IndexedDBStorage can only be used in a browser environment');
    }
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: ['userId', 'sessionId'] });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  async saveMessage(userId: string, item: MemoryItem, sessionId: string = 'default'): Promise<void> {
    const db = await this.getDB();
    const history = await this.getHistory(userId, undefined, sessionId);
    history.push(item);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put({ userId, sessionId, messages: history, updatedAt: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getHistory(userId: string, limit?: number, sessionId: string = 'default'): Promise<MemoryItem[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get([userId, sessionId]);

      request.onsuccess = () => {
        const result = request.result;
        if (!result || !result.messages) {
          resolve([]);
        } else {
          const history = result.messages as MemoryItem[];
          resolve(limit ? history.slice(-limit) : history);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async clear(userId: string, sessionId: string = 'default'): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete([userId, sessionId]);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
