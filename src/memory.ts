import type { MemoryItem, IMemoryStorage } from './types.js';

/**
 * Zentis Memory Singleton
 * Centralized store for agent history and notes
 */
export class ZentisMemory {
  private static instance: ZentisMemory;
  public history: MemoryItem[] = [];
  public notes: string[] = [];
  private storage?: IMemoryStorage;
  private userId: string = 'default';

  private constructor() {}

  public static getInstance(): ZentisMemory {
    if (!ZentisMemory.instance) {
      ZentisMemory.instance = new ZentisMemory();
    }
    return ZentisMemory.instance;
  }

  /**
   * Configure storage backend and user context
   */
  public setStorage(storage: IMemoryStorage, userId: string = 'default'): void {
    this.storage = storage;
    this.userId = userId;
  }

  /**
   * Set the current user ID for scoped memory
   */
  public setUserId(userId: string): void {
    this.userId = userId;
  }

  async addMessage(
    role: MemoryItem['role'], 
    content: string | null, 
    extra?: { metadata?: Record<string, any>; tool_calls?: any[]; tool_call_id?: string }
  ): Promise<void> {
    const item: MemoryItem = {
      role,
      content,
      metadata: extra?.metadata,
      tool_calls: extra?.tool_calls,
      tool_call_id: extra?.tool_call_id,
      timestamp: Date.now()
    };

    this.history.push(item);

    if (this.storage) {
      await this.storage.saveMessage(this.userId, item);
    }
  }

  async addNote(content: any): Promise<void> {
    const stringified = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.notes.push(stringified);
    await this.addMessage('system', `Note added: ${stringified}`);
  }

  async popNote(): Promise<string | undefined> {
    const note = this.notes.pop();
    if (note) {
      await this.addMessage('system', `Note removed: ${note}`);
    }
    return note;
  }

  async getHistory(limit: number = 10): Promise<MemoryItem[]> {
    if (this.storage) {
      return await this.storage.getHistory(this.userId, limit);
    }
    return this.history.slice(-limit);
  }

  async clear(): Promise<void> {
    this.history = [];
    this.notes = [];
    if (this.storage) {
      await this.storage.clear(this.userId);
    }
  }
}
