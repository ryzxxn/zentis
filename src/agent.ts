import { ZentisMcpClient } from './client.js';
import { ZentisMemory } from './memory.js';
import { ZentisLlmClient } from './llm.js';
import { BrowserStorage, SQLiteStorage, PostgresStorage, IndexedDBStorage } from './lib/storage/index.js';
import type OpenAI from 'openai';
import type { AgentResponse, UIComponent, UIAction, StorageConfig, LLMConfig } from './types.js';

export interface ZentisAgentOptions {
  client?: ZentisMcpClient;
  memory?: ZentisMemory;
  llm?: ZentisLlmClient | LLMConfig;
  storage?: StorageConfig;
}

/**
 * Zentis Agent
 * A higher-level abstraction that integrates Client, Memory, and optionally LLM.
 */
export class ZentisAgent {
  public client: ZentisMcpClient;
  public memory: ZentisMemory;
  public llm?: ZentisLlmClient;

  constructor(options: ZentisAgentOptions = {}) {
    this.client = options.client || ZentisMcpClient.getInstance();
    this.memory = options.memory || ZentisMemory.getInstance();
    
    if (options.llm instanceof ZentisLlmClient) {
      this.llm = options.llm;
    } else if (options.llm) {
      this.llm = new ZentisLlmClient(options.llm);
    }

    if (options.storage) {
      this.configureStorage(options.storage);
    }
  }

  /**
   * Internal helper to configure storage based on config object
   */
  private configureStorage(config: StorageConfig) {
    let storage;
    const userId = config.userId || 'default';

    switch (config.type) {
      case 'local':
      case 'session':
        storage = new BrowserStorage(config.type, config.keyPrefix);
        break;
      case 'sqlite':
        storage = new SQLiteStorage(config.connectionString || 'zentis.db');
        break;
      case 'postgres':
        if (!config.connectionString) throw new Error('Postgres requires connectionString');
        storage = new PostgresStorage(config.connectionString);
        break;
      case 'indexeddb':
        storage = new IndexedDBStorage(config.dbName, config.storeName);
        break;
      default:
        throw new Error(`Unsupported storage type: ${config.type}`);
    }

    this.memory.setStorage(storage, userId);
  }

  /**
   * Push a note onto the agent's internal stack (supports string, number, object, array)
   */
  async note(content: any): Promise<void> {
    await this.memory.addNote(content);
  }

  /**
   * Pop the most recent note from the stack
   */
  async popNote(): Promise<string | undefined> {
    return await this.memory.popNote();
  }

  /**
   * Get all notes in the stack
   */
  getNotes(): string[] {
    return [...this.memory.notes];
  }

  /**
   * Add a message to the agent's memory
   */
  async remember(role: any, content: string | null, extra?: { metadata?: Record<string, any>; tool_calls?: any[]; tool_call_id?: string }): Promise<void> {
    await this.memory.addMessage(role, content, extra);
  }

  /**
   * Retrieve relevant context from memory
   */
  async recall(limit: number = 10) {
    return await this.memory.getHistory(limit);
  }

  /**
   * Clear the agent's memory (history and notes)
   */
  async clearMemory(): Promise<void> {
    await this.memory.clear();
  }

  /**
   * List tools across all connected servers
   */
  async listAvailableTools() {
    return await this.client.listTools();
  }

  /**
   * Execute a tool and store the interaction in memory
   */
  async executeTool(serverName: string, toolName: string, args: Record<string, any>, toolCallId?: string) {
    await this.memory.addMessage('system', `Calling tool "${toolName}" on server "${serverName}"`, { metadata: { toolName, serverName, args } });
    
    try {
      const result = await this.client.callTool(serverName, toolName, args);
      await this.memory.addMessage('tool', JSON.stringify(result), { tool_call_id: toolCallId });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.memory.addMessage('system', `Tool execution failed: ${errorMessage}`, { metadata: { toolName, serverName, error } });
      throw error;
    }
  }

  /**
   * Execute multiple tools in parallel and store interactions in memory
   */
  async executeToolsParallel(calls: { serverName: string; toolName: string; args: Record<string, any>; toolCallId?: string }[]) {
    const promises = calls.map(async (call) => {
      await this.memory.addMessage('system', `Parallel call: ${call.toolName} on ${call.serverName}`, { metadata: { ...call.args } });
      try {
        const result = await this.client.callTool(call.serverName, call.toolName, call.args);
        await this.memory.addMessage('tool', JSON.stringify(result), { tool_call_id: call.toolCallId });
        return { ...call, result };
      } catch (error) {
        await this.memory.addMessage('system', `Parallel call failed: ${call.toolName}`, { metadata: { error } });
        throw error;
      }
    });
    return await Promise.all(promises);
  }

  /**
   * Internal helper to parse UI components and actions from text
   * Syntax: 
   * [UI:ComponentName]{"json":"data"}[/UI]
   * [ACTION:Type]{"targetId": "id", "metadata": {}}[/ACTION]
   */
  private parseResponse(text: string): { cleanText: string; components: UIComponent[]; actions: UIAction[] } {
    const components: UIComponent[] = [];
    const actions: UIAction[] = [];
    
    // Parse Components
    const compRegex = /\[UI:(\w+)\]([\s\S]*?)\[\/UI\]/g;
    let cleanText = text.replace(compRegex, (match, name, jsonStr) => {
      try {
        const props = JSON.parse(jsonStr.trim());
        components.push({ name, props });
      } catch (e) {
        console.error(`Failed to parse UI component ${name}:`, e);
      }
      return ""; 
    });

    // Parse Actions
    const actionRegex = /\[ACTION:(\w+)\]([\s\S]*?)\[\/ACTION\]/g;
    cleanText = cleanText.replace(actionRegex, (match, type, jsonStr) => {
      try {
        const data = JSON.parse(jsonStr.trim());
        actions.push({ type: type.toLowerCase() as any, ...data });
      } catch (e) {
        console.error(`Failed to parse UI action ${type}:`, e);
      }
      return "";
    }).trim();

    return { cleanText, components, actions };
  }

  /**
   * Answer a user query by using available tools, memory, and the LLM.
   * This method implements a multi-turn tool-calling loop with parallel execution.
   */
  async query(
    userMessage: string, 
    options: { 
      onAction?: (action: { tool: string; args: any; server: string }) => void;
      model?: string;
    } = {}
  ): Promise<AgentResponse> {
    if (!this.llm) {
      throw new Error("Agent: Cannot perform query without an LLM client.");
    }

    // 1. Gather tools and map them to OpenAI format
    const mcpToolsMap = await this.client.listTools();
    const availableTools: OpenAI.Chat.ChatCompletionTool[] = [];
    const toolToManagerMap: Record<string, string> = {}; 

    for (const [serverName, tools] of Object.entries(mcpToolsMap)) {
      for (const tool of tools) {
        availableTools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema as any
          }
        });
        toolToManagerMap[tool.name] = serverName;
      }
    }

    // 2. Prepare messages from history
    const history = await this.memory.getHistory(15);
    const notes = this.getNotes();
    
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are Zentis, a helpful AI assistant with access to real-time tools.
Current Context (Notes):
${notes.length > 0 ? notes.join('\n') : 'No specific notes.'}

Instructions:
- Use tools to answer factual questions or perform actions.
- If a tool is available, ALWAYS use it instead of guessing.
- Keep responses conversational and direct.
- Never mention internal technical IDs unless asked.

UI CAPABILITIES:
- You can trigger specific UI components to be rendered on the user's browser.
- Use the syntax: [UI:ComponentName]{"prop1": "value", "className": "tailwind classes"}[/UI]
- Available components: 
  - "VideoPlayer": props { "url": string, "title": string, "className": string }
  - "Map": props { "lat": number, "lng": number, "zoom": number, "className": string }
  - "Chart": props { "type": "bar"|"line", "data": array, "className": string }
  - "Table": props { "headers": string[], "rows": any[][], "title": string, "className": string }
- Example: "Here is the footage: [UI:VideoPlayer]{\"url\": \"https://...\", \"title\": \"Camera 1\", \"className\": \"rounded-xl border-2 border-blue-500 shadow-lg\"}[/UI]"
- You can use any standard Tailwind CSS classes for layout, borders, spacing, and colors.

UI ACTIONS (WEB API):
- You can interact with existing elements or newly rendered components.
- Syntax: [ACTION:Type]{"targetId": "element-id", "metadata": { "key": "val" }}[/ACTION]
- Available Actions:
  - "highlight": Highlights a specific component or text block.
  - "click": Simulates a click on a button or link.
  - "focus": Sets focus to an input field.
  - "scroll": Scrolls an element into view.
- Example: "I have highlighted the relevant row for you. [ACTION:highlight]{\"targetId\": \"row-5\"}[/ACTION]"`
      },
      ...history
        .filter(h => h.role !== 'system') 
        .map(h => {
          const msg: any = { role: h.role, content: h.content };
          if (h.tool_calls) msg.tool_calls = h.tool_calls;
          if (h.tool_call_id) msg.tool_call_id = h.tool_call_id;
          return msg;
        })
    ];

    messages.push({ role: 'user', content: userMessage });
    await this.memory.addMessage('user', userMessage);

    let loopCount = 0;
    const maxLoops = 10; 

    while (loopCount < maxLoops) {
      const response = await this.llm.chat({
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
        tool_choice: availableTools.length > 0 ? 'auto' : undefined,
        model: options.model
      });

      const message = response.choices[0]?.message;
      if (!message) break;

      await this.memory.addMessage('assistant', message.content, { tool_calls: message.tool_calls });
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolPromises = message.tool_calls.map(async (toolCall) => {
          if (toolCall.type !== 'function') return null;

          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          const serverName = toolToManagerMap[toolName];

          if (!serverName) {
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: `Tool ${toolName} not found on any connected server.`
            };
          }

          if (options.onAction) {
            options.onAction({ tool: toolName, args, server: serverName });
          }

          try {
            const result = await this.executeTool(serverName, toolName, args, toolCall.id);
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            };
          } catch (error: any) {
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: `Error executing tool: ${error.message || String(error)}`
            };
          }
        });

        const toolResults = await Promise.all(toolPromises);
        toolResults.forEach(res => {
          if (res) messages.push(res);
        });

        loopCount++;
      } else {
        // Final answer - parse UI components and actions
        const rawText = message.content || "";
        const { cleanText, components, actions } = this.parseResponse(rawText);
        
        return { text: cleanText, components, actions };
      }
    }

    return { text: "I've reached my maximum reasoning limit for this query.", components: [], actions: [] };
  }
}
