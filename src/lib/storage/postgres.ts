import type { IMemoryStorage, MemoryItem } from '../../types.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * PostgreSQL implementation of Zentis Memory Storage
 * Requires 'pg' package
 */
export class PostgresStorage implements IMemoryStorage {
  private pool: any;

  constructor(config: string | { connectionString?: string; pool?: any; ssl?: any }) {
    if (typeof config === 'object' && config.pool) {
      this.pool = config.pool;
      this.init();
      return;
    }

    try {
      const { Pool } = require('pg');
      const connectionString = typeof config === 'string' ? config : config.connectionString;
      const ssl = typeof config === 'string' ? false : config.ssl;

      this.pool = new Pool({ 
        connectionString,
        ssl: ssl || false
      });
      this.init();
    } catch (e) {
      throw new Error('PostgresStorage requires "pg" package. Please install it.');
    }
  }

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS zentis_history (
        user_id TEXT,
        session_id TEXT,
        messages JSONB NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, session_id)
      )
    `);
  }

  async saveMessage(userId: string, item: MemoryItem, sessionId: string = 'default'): Promise<void> {
    const history = await this.getHistory(userId, undefined, sessionId);
    history.push(item);
    
    await this.pool.query(`
      INSERT INTO zentis_history (user_id, session_id, messages, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, session_id) DO UPDATE SET
        messages = EXCLUDED.messages,
        updated_at = EXCLUDED.updated_at
    `, [userId, sessionId, JSON.stringify(history), Date.now()]);
  }

  async getHistory(userId: string, limit?: number, sessionId: string = 'default'): Promise<MemoryItem[]> {
    const res = await this.pool.query('SELECT messages FROM zentis_history WHERE user_id = $1 AND session_id = $2', [userId, sessionId]);
    if (res.rows.length === 0) return [];
    
    const history = res.rows[0].messages as MemoryItem[];
    return limit ? history.slice(-limit) : history;
  }

  async clear(userId: string, sessionId: string = 'default'): Promise<void> {
    await this.pool.query('DELETE FROM zentis_history WHERE user_id = $1 AND session_id = $2', [userId, sessionId]);
  }
}
