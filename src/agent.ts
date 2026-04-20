import { ZentisMcpClient } from './client.js';
import { ZentisMemory } from './memory.js';
import { ZentisLlmClient } from './llm.js';
import type OpenAI from 'openai';

/**
 * Zentis Agent
 * A higher-level abstraction that integrates Client, Memory, and optionally LLM.
 */
export class ZentisAgent {
  public client: ZentisMcpClient;
  public memory: ZentisMemory;
  public llm?: ZentisLlmClient;

  constructor(options: { 
    client?: ZentisMcpClient; 
    memory?: ZentisMemory;
    llm?: ZentisLlmClient;
  } = {}) {
    this.client = options.client || ZentisMcpClient.getInstance();
    this.memory = options.memory || ZentisMemory.getInstance();
    this.llm = options.llm;
  }

  /**
   * Push a note onto the agent's internal stack (supports string, number, object, array)
   */
  note(content: any): void {
    this.memory.addNote(content);
  }

  /**
   * Pop the most recent note from the stack
   */
  popNote(): string | undefined {
    return this.memory.popNote();
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
  remember(role: any, content: string | null, extra?: { metadata?: Record<string, any>; tool_calls?: any[]; tool_call_id?: string }): void {
    this.memory.addMessage(role, content, extra);
  }

  /**
   * Retrieve relevant context from memory
   */
  recall(limit: number = 10) {
    return this.memory.getHistory(limit);
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
    this.memory.addMessage('system', `Calling tool "${toolName}" on server "${serverName}"`, { metadata: { toolName, serverName, args } });
    
    try {
      const result = await this.client.callTool(serverName, toolName, args);
      this.memory.addMessage('tool', JSON.stringify(result), { tool_call_id: toolCallId });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.memory.addMessage('system', `Tool execution failed: ${errorMessage}`, { metadata: { toolName, serverName, error } });
      throw error;
    }
  }

  /**
   * Execute multiple tools in parallel and store interactions in memory
   */
  async executeToolsParallel(calls: { serverName: string; toolName: string; args: Record<string, any>; toolCallId?: string }[]) {
    const promises = calls.map(async (call) => {
      this.memory.addMessage('system', `Parallel call: ${call.toolName} on ${call.serverName}`, { metadata: { ...call.args } });
      try {
        const result = await this.client.callTool(call.serverName, call.toolName, call.args);
        this.memory.addMessage('tool', JSON.stringify(result), { tool_call_id: call.toolCallId });
        return { ...call, result };
      } catch (error) {
        this.memory.addMessage('system', `Parallel call failed: ${call.toolName}`, { metadata: { error } });
        throw error;
      }
    });
    return await Promise.all(promises);
  }

  /**
   * Answer a user query by using available tools, memory, and the LLM.
   * This method implements a multi-turn tool-calling loop with parallel execution.
   */
  async query(
    userMessage: string, 
    options: { onAction?: (action: { tool: string; args: any; server: string }) => void } = {}
  ): Promise<string> {
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
    const history = this.memory.getHistory(15);
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
- Multiple tools can be called at once if needed.
- Keep responses conversational and direct.
- Never mention internal technical IDs unless asked.`
      },
      ...history
        .filter(h => h.role !== 'system') // Skip internal system logs for the LLM context
        .map(h => {
          const msg: any = { role: h.role, content: h.content };
          if (h.tool_calls) msg.tool_calls = h.tool_calls;
          if (h.tool_call_id) msg.tool_call_id = h.tool_call_id;
          return msg;
        })
    ];

    messages.push({ role: 'user', content: userMessage });
    this.memory.addMessage('user', userMessage);

    let loopCount = 0;
    const maxLoops = 10; // Increased loop limit for smarter reasoning

    while (loopCount < maxLoops) {
      const response = await this.llm.chat({
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
        tool_choice: availableTools.length > 0 ? 'auto' : undefined
      });

      const message = response.choices[0]?.message;
      if (!message) break;

      // Store assistant message with its tool calls if any
      this.memory.addMessage('assistant', message.content, { tool_calls: message.tool_calls });
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        // Execute all tool calls in this turn in parallel
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

          // Trigger action callback if provided
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
        // No more tool calls, final answer received
        return message.content || "";
      }
    }

    return "I've reached my maximum reasoning limit for this query.";
  }

  /**
   * Clear agent memory
   */
  clearMemory(): void {
    this.memory.clear();
  }
}
