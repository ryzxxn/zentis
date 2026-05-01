import type { IMemoryStorage, MemoryItem } from '../../types.js';

export class SQLiteStorage implements IMemoryStorage {
  constructor() {
    throw new Error('SQLiteStorage is not available in the browser');
  }
  async saveMessage(_userId: string, _item: MemoryItem, _sessionId?: string): Promise<void> {}
  async getHistory(_userId: string, _limit?: number, _sessionId?: string): Promise<MemoryItem[]> { return []; }
  async clear(_userId: string, _sessionId?: string): Promise<void> {}
}
