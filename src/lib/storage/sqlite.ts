import type { IMemoryStorage, MemoryItem } from '../../types.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * SQLite implementation of Zentis Memory Storage
 * Requires 'better-sqlite3' package
 */
export class SQLiteStorage implements IMemoryStorage {
  private db: any;

  constructor(dbPath: string = 'zentis.db') {
    if (typeof window !== 'undefined') {
      throw new Error('SQLiteStorage is not available in the browser environment');
    }

    try {
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
        user_id TEXT,
        session_id TEXT,
        messages TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id)
      )
    `).run();
  }

  async saveMessage(userId: string, item: MemoryItem, sessionId: string = 'default'): Promise<void> {
    const history = await this.getHistory(userId, undefined, sessionId);
    history.push(item);
    
    this.db.prepare(`
      INSERT INTO zentis_history (user_id, session_id, messages, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, session_id) DO UPDATE SET
        messages = excluded.messages,
        updated_at = excluded.updated_at
    `).run(userId, sessionId, JSON.stringify(history), Date.now());
  }

  async getHistory(userId: string, limit?: number, sessionId: string = 'default'): Promise<MemoryItem[]> {
    const row = this.db.prepare('SELECT messages FROM zentis_history WHERE user_id = ? AND session_id = ?').get(userId, sessionId);
    if (!row) return [];
    
    try {
      const history = JSON.parse(row.messages) as MemoryItem[];
      return limit ? history.slice(-limit) : history;
    } catch {
      return [];
    }
  }

  async clear(userId: string, sessionId: string = 'default'): Promise<void> {
    this.db.prepare('DELETE FROM zentis_history WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
  }
}
