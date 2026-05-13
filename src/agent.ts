import { ZentisMcpClient } from './client.js';
import { ZentisMemory } from './memory.js';
import { ZentisLlmClient } from './llm.js';
import { ZentisUI } from './ui.js';
import { createStorage } from './lib/storage/factory.js';
import type OpenAI from 'openai';
import type { AgentResponse, UIComponent, StorageConfig, LLMConfig, QueryOptions, McpServerConfig, ToolInteraction } from './types.js';

export interface ZentisAgentOptions {
  client?: ZentisMcpClient;
  memory?: ZentisMemory;
  ui?: ZentisUI;
  llm?: ZentisLlmClient | LLMConfig;
  storage?: StorageConfig;
  mcp?: McpServerConfig | McpServerConfig[];
  tool_router?: boolean; 
  planner?: boolean;
  maxTurns?: number;
  maxHistoryMessages?: number; 
}

export class ZentisAgent {
  public client: ZentisMcpClient;
  public memory: ZentisMemory;
  public ui: ZentisUI;
  public llm?: ZentisLlmClient;
  public mcpConfig?: McpServerConfig | McpServerConfig[];
  public options: { tool_router: boolean; planner: boolean; maxTurns: number; maxHistoryMessages: number };
  private readyPromise: Promise<void> = Promise.resolve();

  constructor(options: ZentisAgentOptions = {}) {
    this.client = options.client || new ZentisMcpClient();
    this.memory = options.memory || new ZentisMemory();
    this.ui = options.ui || new ZentisUI();
    this.mcpConfig = options.mcp;
    this.options = {
      tool_router: options.tool_router ?? false,
      planner: options.planner ?? false,
      maxTurns: Math.min(Math.max(options.maxTurns ?? 10, 1), 50),
      maxHistoryMessages: options.maxHistoryMessages ?? 20
    };
    
    if (options.llm instanceof ZentisLlmClient) {
      this.llm = options.llm;
    } else if (options.llm) {
      this.llm = new ZentisLlmClient(options.llm);
    }

    if (options.storage) {
      this.readyPromise = (async () => {
        await this.readyPromise;
        await this.configureStorage(options.storage!);
      })();
    }

    if (options.mcp) {
      const currentReady = this.readyPromise;
      this.readyPromise = (async () => {
        await currentReady;
        await this.initMcp(options.mcp!);
      })();
    }
  }

  async waitReady(): Promise<void> {
    await this.readyPromise;
  }

  private async initMcp(config: McpServerConfig | McpServerConfig[]) {
    const servers = Array.isArray(config) ? config : [config];
    await this.client.connectMany(servers);
  }

  private async configureStorage(config: StorageConfig) {
    const userId = config.userId || 'default';
    const sessionId = config.sessionId || 'default';
    const storage = createStorage(config);
    await this.memory.setStorage(storage, userId, sessionId);
  }

  async note(content: any): Promise<void> {
    await this.memory.addNote(content);
  }

  async popNote(): Promise<string | undefined> {
    return await this.memory.popNote();
  }

  getNotes(): string[] {
    return [...this.memory.notes];
  }

  async remember(role: any, content: string | null, extra?: { metadata?: Record<string, any> }): Promise<void> {
    await this.memory.addMessage(role, content, extra);
  }

  async recall(limit: number = 10) {
    return await this.memory.getHistory(limit);
  }

  async clearMemory(): Promise<void> {
    await this.memory.clear();
  }

  /**
   * Reset the agent's internal state, history, and notes.
   * Useful for starting a fresh conversation without creating a new instance.
   */
  async reset(): Promise<void> {
    await this.clearMemory();
  }

  /**
   * Cleanup resources, disconnect from MCP servers and close storage
   */
  async destroy(): Promise<void> {
    await this.client.disconnectAll();
    await this.memory.close();
  }

  async listAvailableTools() {
    await this.readyPromise;
    return await this.client.listTools();
  }

  private parseResponse(text: string, sessionResults: Record<string, any> = {}): { cleanText: string; components: UIComponent[] } {
    const components: UIComponent[] = [];
    
    // 1. Extract and remove UI components
    const compRegex = /\[UI:(\w+)\]([\s\S]*?)\[\/UI\]/g;
    let cleanText = text.replace(compRegex, (match, name, jsonStr) => {
      try {
        const props = JSON.parse(jsonStr.trim());
        
        // Smarter Results: If props has a data/dataSource/records/rows field pointing to a session result, swap it
        const dataKeys = ['data', 'dataSource', 'records', 'rows', 'items', 'forecast'];
        for (const key of dataKeys) {
          const val = props[key];
          if (typeof val === 'string' && sessionResults[val]) {
            props[key] = sessionResults[val];
          }
        }

        components.push({ name, props });
      } catch (e) {
        console.error(`Failed to parse UI component ${name}:`, e);
      }
      return ""; 
    });

    // 2. Final cleanup of ALL internal Zentis-style tags and artifacts
    cleanText = cleanText
      .replace(/\[ACTION:(\w+)\]([\s\S]*?)\[\/ACTION\]/g, "") // Remove actions if they appear in text
      .replace(/\[CALL:[^\]]+\][\s\S]*?(\[\/CALL\]|$)/gi, "")
      .replace(/\[RESULT:[^\]]+\][\s\S]*?(\[\/RESULT\]|$)/gi, "")
      .replace(/\[DATA_REFERENCE\][\s\S]*?(\[\/DATA_REFERENCE\]|$)/gi, "")
      .replace(/\[DATA_REFERENCE:[^\]]+\]/gi, "")
      .replace(/\[SYSTEM_NOTICE\][\s\S]*?(\n|$)/gi, "")
      .replace(/TOOL PLAN:[\s\S]*?(\n|$)/gi, "")
      .replace(/\n{3,}/g, "\n\n") // Remove excessive whitespace
      .trim();

    return { cleanText, components };
  }

  async query(
    userMessage: string, 
    options: QueryOptions = {}
  ): Promise<AgentResponse> {
    if (!this.llm) {
      throw new Error("Agent: Cannot perform query without an LLM client.");
    }

    await this.readyPromise;
    
    if (options.onStep) {
      options.onStep({ type: 'thinking', message: 'Initializing agent...' });
    }

    const maxHistory = options.maxHistoryChars || 20000;
    const maxMessages = options.maxHistoryMessages || this.options.maxHistoryMessages;
    const sessionResults: Record<string, any> = {};
    const interactions: ToolInteraction[] = [];
    const callHistory = new Set<string>(); // Recursion Guard: Track tool calls to prevent infinite loops

    const mcpToolsMap = await this.client.listTools();
    const toolToManagerMap: Record<string, string> = {}; 
    const allToolsList: any[] = [];
    let allToolDescriptions = "";
    
    for (const [serverName, tools] of Object.entries(mcpToolsMap)) {
      for (const tool of tools) {
        allToolsList.push({ ...tool, serverName });
        const schema = JSON.stringify(tool.inputSchema?.properties || {});
        allToolDescriptions += `- ${tool.name}: ${tool.description} | Args: ${schema}\n`;
        toolToManagerMap[tool.name] = serverName; // Map ALL tools
      }
    }

    let toolPlan = "";
    let allowedTools: Set<string> | null = null;
    const TOOL_LIMIT = 20;
    const useSearchTool = allToolsList.length > TOOL_LIMIT && !this.options.planner && !this.options.tool_router;

    if (this.options.planner) {
      if (options.onStep) {
        options.onStep({ type: 'thinking', message: 'Planning tool sequence...' });
      }

      const plannerResponse = await this.llm.chat({
        messages: [
          { role: 'system', content: `You are a Tool Planner. Given a user query and a set of tools, identify the exact sequence of tools needed.
Output a JSON array of tool names, or ["NONE"] if no tools are needed.
Be thorough but concise.

TOOLS:
${allToolDescriptions}` },
          { role: 'user', content: userMessage }
        ]
      });

      const planRaw = plannerResponse.choices[0]?.message?.content || "";
      try {
        const jsonMatch = planRaw.match(/\[.*\]/s);
        const toolsInPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : planRaw.split(',').map((t: string) => t.trim());
        
        if (toolsInPlan.length > 0 && toolsInPlan[0] !== "NONE") {
          allowedTools = new Set(toolsInPlan.map((t: string) => t.toLowerCase()));
          toolPlan = `TOOL PLAN: ${toolsInPlan.join(', ')}`;
        }
      } catch (e) {
        // Fallback to comma separation
        const toolsInPlan = planRaw.split(',').map(t => t.trim().toLowerCase());
        if (toolsInPlan.length > 0 && toolsInPlan[0] !== "none") {
          allowedTools = new Set(toolsInPlan);
          toolPlan = `TOOL PLAN: ${planRaw}`;
        }
      }
    }

    let toolDescriptions = "";
    const keywords = (this.options.tool_router || useSearchTool) ? userMessage.toLowerCase().split(/[\s,._-]+/) : [];

    if (useSearchTool) {
      toolDescriptions += `- search_tools: Search for tools matching a specific query. Use this if you need a tool that is not in the list. | Args: {"query": "string"}\n`;
    }

    for (const tool of allToolsList) {
      if (allowedTools) {
        if (!allowedTools.has(tool.name.toLowerCase())) continue;
      } else if (this.options.tool_router) {
        const content = (tool.name + " " + tool.description).toLowerCase();
        // Enhanced router: check for any keyword match or partial match
        const matches = keywords.some(k => k.length > 2 && (content.includes(k) || k.includes(tool.name.toLowerCase())));
        if (!matches) continue;
      } else if (useSearchTool) {
        // If we are using the search tool, only show a few core tools or matches
        const content = (tool.name + " " + tool.description).toLowerCase();
        const matches = keywords.some(k => k.length > 3 && content.includes(k));
        if (!matches) continue;
      }

      const properties = { ...(tool.inputSchema?.properties || {}) };
      if (options.extraArgs) {
        for (const key of Object.keys(options.extraArgs)) {
          delete properties[key];
        }
      }
      
      const schema = JSON.stringify(properties);
      toolDescriptions += `- ${tool.name}: ${tool.description} | Args: ${schema}\n`;
    }

    const toolInstructions = toolDescriptions.length > 0 ? `
AVAILABLE TOOLS:
${toolDescriptions}
TO CALL TOOLS:
- Use [CALL:tool_name]{"arg":val}[/CALL] for each tool.
- You can call multiple tools in one turn.
- Zentis will execute them and provide results as [RESULT:tool_name]...[/RESULT].
- After getting results, provide a conversational response or UI components.
- Do NOT repeat the tool call once you have the result.
- Use result IDs (e.g., "res_1_tool_name") in UI components to reference large datasets.` : "";

    const uiInstructions = this.ui.generateInstructions();
    const notes = this.getNotes();
    const systemPrompt = `${notes.join('\n')}\n${toolPlan}\n${toolInstructions}\n\n${uiInstructions}`;

    let history = await this.memory.getHistory(maxMessages);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    let totalChars = 0;
    for (const h of history) {
      if (h.role !== 'system') {
        const content = String(h.content || "");
        if (totalChars + content.length > maxHistory) break;
        messages.push({ role: h.role as any, content });
        totalChars += content.length;
      }
    }

    messages.push({ role: 'user', content: userMessage });
    await this.memory.addMessage('user', userMessage);

    let loopCount = 0;
    const maxLoops = Math.min(Math.max(options.maxTurns ?? this.options.maxTurns, 1), 50); 

    while (loopCount < maxLoops) {
      if (options.onStep) {
        options.onStep({ type: 'thinking', message: 'Analyzing...', data: { loop: loopCount + 1 } });
      }

      const llmResponse = await this.llm.chat({
        messages,
        model: options.model
      });

      const messageContent = llmResponse.choices[0]?.message?.content || "";

      if (!messageContent) {
        const finishReason = llmResponse.choices[0]?.finish_reason;
        messages.push({ 
          role: 'user', 
          content: `[SYSTEM_NOTICE] The previous turn returned an empty response with reason: ${finishReason}. Please attempt to provide a conversational response or a clear tool call to proceed.` 
        });
        loopCount++;
        continue;
      }

      messages.push({ role: 'assistant', content: messageContent });

      // Robust tool call parsing (handles missing closing tags and multiple calls)
      const toolCallRegex = /\[CALL:([a-zA-Z0-9_-]+)\]([\s\S]*?)(?=\[CALL:|\[\/CALL\]|$)/g;
      const toolMatches = Array.from(messageContent.matchAll(toolCallRegex));

      if (toolMatches.length > 0) {
        // Process all tool calls in the current turn
        for (let i = 0; i < toolMatches.length; i++) {
          const match = toolMatches[i] as RegExpMatchArray;
          const toolName = match[1];
          const argsString = match[2].trim();
          const serverName = toolToManagerMap[toolName];

          // Recursion Guard: Check if this exact call was already made
          const callKey = `${toolName}:${argsString}`;
          if (callHistory.has(callKey)) {
            messages.push({ 
              role: 'user', 
              content: `[SYSTEM_NOTICE] Recursion detected: You already called "${toolName}" with these arguments in this session. To avoid infinite loops, this call was blocked. Please try a different approach or conclude if the task is done.` 
            });
            continue;
          }
          callHistory.add(callKey);

          let args = {};
          try {
            args = argsString ? JSON.parse(argsString) : {};
          } catch (e) {
            console.error(`Failed to parse tool args: ${argsString}`);
          }

          const extraArgs = options.extraArgs || {};

          if (options.onAction) {
            options.onAction({ 
              tool: toolName, 
              args: { ...args, ...extraArgs }, 
              server: serverName || 'UNKNOWN', 
              extraArgs: extraArgs 
            });
          }

          if (options.onStep) {
            options.onStep({ type: 'tool_call', message: `Executing ${toolName}...`, data: { tool: toolName } });
          }

          let resultContent = "";
          
          // Handle Internal/Virtual Tools (like search_tools)
          if (toolName === 'search_tools') {
            const query = args.query?.toLowerCase() || "";
            const matches = allToolsList.filter(t => 
              t.name.toLowerCase().includes(query) || 
              t.description.toLowerCase().includes(query)
            );
            
            if (matches.length === 0) {
              resultContent = `No tools found matching "${query}". Try a broader search.`;
            } else {
              resultContent = "Found the following tools matching your search. You can now use them in the next turn:\n";
              for (const t of matches) {
                const schema = JSON.stringify(t.inputSchema?.properties || {});
                resultContent += `- ${t.name}: ${t.description} | Args: ${schema}\n`;
              }
            }
          } else if (!serverName) {
            resultContent = `{"error": "Tool '${toolName}' does not exist."}`;
          } else {
            try {
              const rawResult = await this.client.callTool(serverName, toolName, args, extraArgs);
              const resObj = rawResult as any;
              let data = (typeof resObj === 'object' && resObj !== null) 
                ? (resObj.structuredContent || resObj.structured_content || resObj.data || rawResult)
                : rawResult;
              
              if (data && typeof data === 'object' && ('result' in data || 'data' in data)) {
                data = data.result || data.data;
              }

              const resultId = `res_${loopCount + 1}_${toolName}_${i}`;
              sessionResults[resultId] = data;
              interactions.push({ 
                id: resultId, 
                tool: toolName, 
                args: { ...args, ...extraArgs }, 
                result: data,
                timestamp: Date.now()
              });

              // Smarter Results: Context Slicing for large datasets
              if (Array.isArray(data) && data.length > 5 && typeof data[0] === 'object') {
                const keys = Object.keys(data[0]);
                resultContent = `[DATA_REFERENCE:${resultId}] This result contains a list of ${data.length} objects from tool '${toolName}'. 
Available fields: ${JSON.stringify(keys)}. 
The raw data is hidden for speed and security. To display this specific dataset, use its ID "${resultId}" in the "data" property of a UI component.
You can apply "filters" (key-value pairs) or "columns" (array of strings) to the component to dynamically narrow down what the user sees.`;
              } else {
                resultContent = typeof data === 'string' ? data : JSON.stringify(data);
              }
            } catch (err: any) {
              resultContent = `{"error": "${err.message}"}`;
            }
          }

          if (options.onStep) {
            options.onStep({ type: 'tool_result', message: `Tool ${toolName} finished`, data: { result: resultContent } });
          }

          messages.push({ 
            role: 'user', 
            content: `[RESULT:${toolName}]\n${resultContent}\n[/RESULT]` 
          });
        }

        loopCount++;

      } else {
        const { cleanText, components } = this.parseResponse(messageContent, sessionResults);
        await this.memory.addMessage('assistant', messageContent);

        if (options.onStep) {
          options.onStep({ type: 'complete', message: 'Final response generated', data: { components } });
        }

        return { 
          text: cleanText, 
          components, 
          results: sessionResults,
          interactions,
          mainResult: Object.values(sessionResults).pop() 
        };
      }
    }

    return { text: "I apologize, but I reached the maximum number of reasoning steps.", components: [] };
  }
}
