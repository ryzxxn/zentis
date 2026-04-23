import type { IMemoryStorage, MemoryItem } from '../../types.js';

export class BrowserStorage implements IMemoryStorage {
  private storage: Storage;
  private keyPrefix: string;

  constructor(type: 'local' | 'session' = 'local', keyPrefix: string = 'zentis_chat_') {
    if (typeof window === 'undefined') {
      throw new Error('BrowserStorage can only be used in a browser environment');
    }
    this.storage = type === 'local' ? window.localStorage : window.sessionStorage;
    this.keyPrefix = keyPrefix;
  }

  async saveMessage(userId: string, item: MemoryItem): Promise<void> {
    const history = await this.getHistory(userId);
    history.push(item);
    this.storage.setItem(`${this.keyPrefix}${userId}`, JSON.stringify(history));
  }

  async getHistory(userId: string, limit?: number): Promise<MemoryItem[]> {
    const data = this.storage.getItem(`${this.keyPrefix}${userId}`);
    if (!data) return [];
    try {
      const history = JSON.parse(data) as MemoryItem[];
      return limit ? history.slice(-limit) : history;
    } catch {
      return [];
    }
  }

  async clear(userId: string): Promise<void> {
    this.storage.removeItem(`${this.keyPrefix}${userId}`);
  }
}
