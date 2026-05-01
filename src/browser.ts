import { ZentisAgent } from './agent.js';
import { ZentisLlmClient } from './llm.js';
import { ZentisMcpClient } from './client.js';
import { BrowserStorage } from './lib/storage/browser.js';
import { IndexedDBStorage } from './lib/storage/indexeddb.js';

// Browser shims for Node.js built-ins
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.process = window.process || { env: {} };
  // @ts-ignore
  window.Zentis = { ZentisAgent, ZentisLlmClient, ZentisMcpClient, BrowserStorage, IndexedDBStorage };
  console.log('🚀 Zentis Library Loaded Successfully');
}
