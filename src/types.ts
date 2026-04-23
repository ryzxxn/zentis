import { Client, Transport } from '@modelcontextprotocol/client';

export interface ServerConnection {
  client: Client;
  transport: Transport;
}

export interface ConnectionOptions {
  silent?: boolean;
  transportType?: 'sse' | 'http';
  onNotification?: (notification: any) => void;
}

export interface UIComponent {
  name: string;
  props: Record<string, any>;
}

export interface UIAction {
  type: 'highlight' | 'click' | 'focus' | 'scroll' | 'custom';
  targetId?: string;
  metadata?: Record<string, any>;
}

export interface MemoryItem {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  metadata?: Record<string, any>;
  tool_calls?: any[]; 
  tool_call_id?: string;
  component?: UIComponent; // New: optional UI component data
  timestamp: number;
}

export interface IMemoryStorage {
  saveMessage(userId: string, item: MemoryItem): Promise<void>;
  getHistory(userId: string, limit?: number): Promise<MemoryItem[]>;
  clear(userId: string): Promise<void>;
}

export type StorageType = 'local' | 'session' | 'sqlite' | 'postgres' | 'indexeddb';

export interface LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface StorageConfig {
  type: StorageType;
  userId?: string;
  // For sqlite/postgres
  connectionString?: string; 
  // For browser storage
  keyPrefix?: string;
  // For indexeddb
  dbName?: string;
  storeName?: string;
}

export interface AgentResponse {
  text: string;
  components: UIComponent[];
  actions: UIAction[];
}
