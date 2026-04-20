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

export interface MemoryItem {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  metadata?: Record<string, any>;
  tool_calls?: any[]; // For assistant messages
  tool_call_id?: string; // For tool messages
  timestamp: number;
}
