import { BrowserStorage } from './browser.js';
import { IndexedDBStorage } from './indexeddb.js';
import type { StorageConfig, IMemoryStorage } from '../../types.js';

export function createStorage(config: StorageConfig): IMemoryStorage {
  switch (config.type) {
    case 'local':
    case 'session':
      return new BrowserStorage(config.type, config.keyPrefix);
    case 'indexeddb':
      return new IndexedDBStorage(config.dbName, config.storeName);
    case 'sqlite':
    case 'postgres':
      throw new Error(`${config.type} storage is not available in the browser environment`);
    default:
      throw new Error(`Unsupported storage type: ${config.type}`);
  }
}
