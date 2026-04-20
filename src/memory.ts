import type { MemoryItem } from './types.js';

/**
 * Zentis Memory Singleton
 * Centralized store for agent history and notes
 */
export class ZentisMemory {
  private static instance: ZentisMemory;
  public history: MemoryItem[] = [];
  public notes: string[] = [];

  private constructor() {}

  public static getInstance(): ZentisMemory {
    if (!ZentisMemory.instance) {
      ZentisMemory.instance = new ZentisMemory();
    }
    return ZentisMemory.instance;
  }

  addMessage(
    role: MemoryItem['role'], 
    content: string | null, 
    extra?: { metadata?: Record<string, any>; tool_calls?: any[]; tool_call_id?: string }
  ): void {
    this.history.push({
      role,
      content,
      metadata: extra?.metadata,
      tool_calls: extra?.tool_calls,
      tool_call_id: extra?.tool_call_id,
      timestamp: Date.now()
    });
  }

  addNote(content: any): void {
    const stringified = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.notes.push(stringified);
    this.addMessage('system', `Note added: ${stringified}`);
  }

  popNote(): string | undefined {
    const note = this.notes.pop();
    if (note) {
      this.addMessage('system', `Note removed: ${note}`);
    }
    return note;
  }

  getHistory(limit: number = 10): MemoryItem[] {
    return this.history.slice(-limit);
  }

  clear(): void {
    this.history = [];
    this.notes = [];
  }
}
