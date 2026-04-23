import type { IMemoryStorage, MemoryItem } from '../../types.js';

/**
 * SQLite implementation of Zentis Memory Storage
 * Requires 'better-sqlite3' package
 */
export class SQLiteStorage implements IMemoryStorage {
  private db: any;

  constructor(dbPath: string = 'zentis.db') {
    try {
      // Dynamic import to avoid breaking browser builds
      const Database = require('better-sqlite3');
      this.db = new Database(dbPath);
      this.init();
    } catch (e) {
      throw new Error('SQLiteStorage requires "better-sqlite3" package. Please install it.');
    }
  }

  private init() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS zentis_history (
        user_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();
  }

  async saveMessage(userId: string, item: MemoryItem): Promise<void> {
    const history = await this.getHistory(userId);
    history.push(item);
    
    this.db.prepare(`
      INSERT INTO zentis_history (user_id, messages, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        messages = excluded.messages,
        updated_at = excluded.updated_at
    `).run(userId, JSON.stringify(history), Date.now());
  }

  async getHistory(userId: string, limit?: number): Promise<MemoryItem[]> {
    const row = this.db.prepare('SELECT messages FROM zentis_history WHERE user_id = ?').get(userId);
    if (!row) return [];
    
    try {
      const history = JSON.parse(row.messages) as MemoryItem[];
      return limit ? history.slice(-limit) : history;
    } catch {
      return [];
    }
  }

  async clear(userId: string): Promise<void> {
    this.db.prepare('DELETE FROM zentis_history WHERE user_id = ?').run(userId);
  }
}
