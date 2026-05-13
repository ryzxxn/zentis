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

export interface UIComponentDefinition {
  name: string;
  description: string;
  props: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'data_reference';
    description: string;
    required?: boolean;
  }>;
}

export interface UIComponent {
  name: string;
  props: Record<string, any>;
}

export interface ToolInteraction {
  id: string;
  tool: string;
  args: Record<string, any>;
  result: any;
  timestamp: number;
}

export interface MemoryItem {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  metadata?: Record<string, any>;
  tool_calls?: any[]; 
  tool_call_id?: string;
  timestamp: number;
}

export interface IMemoryStorage {
  saveMessage(userId: string, item: MemoryItem, sessionId?: string): Promise<void>;
  getHistory(userId: string, limit?: number, sessionId?: string): Promise<MemoryItem[]>;
  clear(userId: string, sessionId?: string): Promise<void>;
  close?(): Promise<void>;
}

export type StorageType = 'sqlite' | 'postgres';

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
}

export interface AgentResponse {
  text: string;
  components: UIComponent[];
  /** Full, un-truncated results from tool calls in this session */
  results?: Record<string, any>;
  /** The primary data result of the query, if identifiable */
  mainResult?: any;
  /** Audit log of tool interactions */
  interactions?: ToolInteraction[];
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
  maxTurns?: number;
  skipUIInstructions?: boolean;
  /** Extra arguments passed to tools but not shown to the LLM (e.g. auth tokens) */
  extraArgs?: Record<string, any>;
}
