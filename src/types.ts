import { Client, Transport } from '@modelcontextprotocol/client';

export interface ServerConnection {
  client: Client;
  transport: Transport;
}

export interface ConnectionOptions {
  silent?: boolean;
  transportType?: 'sse' | 'http';
  headers?: Record<string, string>;
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
  saveMessage(userId: string, item: MemoryItem, sessionId?: string): Promise<void>;
  getHistory(userId: string, limit?: number, sessionId?: string): Promise<MemoryItem[]>;
  clear(userId: string, sessionId?: string): Promise<void>;
}

export type StorageType = 'local' | 'session' | 'sqlite' | 'postgres' | 'indexeddb';

export interface LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface McpServerConfig {
  name: string;
  url: string;
  options?: ConnectionOptions;
}

export interface StorageConfig {
  type: StorageType;
  userId?: string;
  sessionId?: string;
  // For sqlite/postgres
  connectionString?: string; 
  ssl?: any;
  pool?: any; // Pre-configured PG pool instance
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

export interface QueryOptions {
  /** Callback triggered when a tool is about to be executed */
  onAction?: (action: { tool: string; args: any; server: string; extraArgs?: Record<string, any> }) => void;
  /** Comprehensive callback for every step of the agent loop (thinking, tool calling, results) */
  onStep?: (step: { 
    type: 'thinking' | 'tool_call' | 'tool_result' | 'complete' | 'error'; 
    message?: string;
    data?: any;
  }) => void;
  model?: string;
  maxHistoryChars?: number; // Proxy for tokens
  maxHistoryMessages?: number; // Number of messages to include
  skipUIInstructions?: boolean;
  /** Extra arguments passed to tools but not shown to the LLM (e.g. auth tokens) */
  extraArgs?: Record<string, any>;
}
