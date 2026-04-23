import type { IMemoryStorage, MemoryItem } from '../../types.js';

/**
 * PostgreSQL implementation of Zentis Memory Storage
 * Requires 'pg' package
 */
export class PostgresStorage implements IMemoryStorage {
  private pool: any;

  constructor(connectionString: string) {
    try {
      const { Pool } = require('pg');
      this.pool = new Pool({ connectionString });
      this.init();
    } catch (e) {
      throw new Error('PostgresStorage requires "pg" package. Please install it.');
    }
  }

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS zentis_history (
        user_id TEXT PRIMARY KEY,
        messages JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
  }

  async saveMessage(userId: string, item: MemoryItem): Promise<void> {
    const history = await this.getHistory(userId);
    history.push(item);
    
    await this.pool.query(`
      INSERT INTO zentis_history (user_id, messages, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET
        messages = EXCLUDED.messages,
        updated_at = EXCLUDED.updated_at
    `, [userId, JSON.stringify(history), Date.now()]);
  }

  async getHistory(userId: string, limit?: number): Promise<MemoryItem[]> {
    const res = await this.pool.query('SELECT messages FROM zentis_history WHERE user_id = $1', [userId]);
    if (res.rows.length === 0) return [];
    
    const history = res.rows[0].messages as MemoryItem[];
    return limit ? history.slice(-limit) : history;
  }

  async clear(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM zentis_history WHERE user_id = $1', [userId]);
  }
}
