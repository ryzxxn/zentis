import { BrowserStorage } from './browser.js';
import { SQLiteStorage } from './sqlite.js';
import { PostgresStorage } from './postgres.js';
import { IndexedDBStorage } from './indexeddb.js';
import type { StorageConfig, IMemoryStorage } from '../../types.js';

export function createStorage(config: StorageConfig): IMemoryStorage {
  switch (config.type) {
    case 'local':
    case 'session':
      return new BrowserStorage(config.type, config.keyPrefix);
    case 'sqlite':
      return new SQLiteStorage(config.connectionString || 'zentis.db');
    case 'postgres':
      if (!config.connectionString && !config.pool) {
        throw new Error('Postgres requires connectionString or pool instance');
      }
      return new PostgresStorage({
        connectionString: config.connectionString,
        pool: config.pool,
        ssl: config.ssl
      });
    case 'indexeddb':
      return new IndexedDBStorage(config.dbName, config.storeName);
    default:
      throw new Error(`Unsupported storage type: ${config.type}`);
  }
}
