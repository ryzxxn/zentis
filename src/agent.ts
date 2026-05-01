import { ZentisMcpClient } from './client.js';
import { ZentisMemory } from './memory.js';
import { ZentisLlmClient } from './llm.js';
import { createStorage } from './lib/storage/factory.js';
import type OpenAI from 'openai';
import type { AgentResponse, UIComponent, UIAction, StorageConfig, LLMConfig, QueryOptions, McpServerConfig } from './types.js';

export interface ZentisAgentOptions {
  client?: ZentisMcpClient;
  memory?: ZentisMemory;
  llm?: ZentisLlmClient | LLMConfig;
  storage?: StorageConfig;
  mcp?: McpServerConfig | McpServerConfig[];
  tool_router?: boolean; 
  planner?: boolean; // New: Enable dedicated planning phase
  maxHistoryMessages?: number; 
}

export class ZentisAgent {
  public client: ZentisMcpClient;
  public memory: ZentisMemory;
  public llm?: ZentisLlmClient;
  public mcpConfig?: McpServerConfig | McpServerConfig[];
  public options: { tool_router: boolean; planner: boolean; maxHistoryMessages: number };
  private readyPromise: Promise<void> = Promise.resolve();

  constructor(options: ZentisAgentOptions = {}) {
    this.client = options.client || ZentisMcpClient.getInstance();
    this.memory = options.memory || ZentisMemory.getInstance();
    this.mcpConfig = options.mcp;
    this.options = {
      tool_router: options.tool_router ?? false,
      planner: options.planner ?? false,
      maxHistoryMessages: options.maxHistoryMessages ?? 20
    };
    
    if (options.llm instanceof ZentisLlmClient) {
      this.llm = options.llm;
    } else if (options.llm) {
      this.llm = new ZentisLlmClient(options.llm);
    }

    if (options.storage) {
      this.configureStorage(options.storage);
    }

    if (options.mcp) {
      this.readyPromise = this.initMcp(options.mcp);
    }
  }

  async waitReady(): Promise<void> {
    await this.readyPromise;
  }

  private async initMcp(config: McpServerConfig | McpServerConfig[]) {
    const servers = Array.isArray(config) ? config : [config];
    await this.client.connectMany(servers);
  }

  private configureStorage(config: StorageConfig) {
    const userId = config.userId || 'default';
    const sessionId = config.sessionId || 'default';
    const storage = createStorage(config);
    this.memory.setStorage(storage, userId, sessionId);
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

  async listAvailableTools() {
    await this.readyPromise;
    return await this.client.listTools();
  }

  private parseResponse(text: string): { cleanText: string; components: UIComponent[]; actions: UIAction[] } {
    const components: UIComponent[] = [];
    const actions: UIAction[] = [];
    
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

  async query(
    userMessage: string, 
    options: QueryOptions = {}
  ): Promise<AgentResponse> {
    if (!this.llm) {
      throw new Error("Agent: Cannot perform query without an LLM client.");
    }

    await this.readyPromise;
    console.log(`\n======================================================`);
    console.log(`[Zentis] New Query: "${userMessage}"`);
    console.log(`======================================================\n`);
    
    if (options.onStep) {
      options.onStep({ type: 'thinking', message: 'Initializing agent...' });
    }

    const maxHistory = options.maxHistoryChars || 20000;
    const maxMessages = options.maxHistoryMessages || this.options.maxHistoryMessages;

    const mcpToolsMap = await this.client.listTools();
    const toolToManagerMap: Record<string, string> = {}; 
    let allToolDescriptions = "";
    
    // Build full descriptions for Planner
    for (const [serverName, tools] of Object.entries(mcpToolsMap)) {
      for (const tool of tools) {
        const schema = JSON.stringify(tool.inputSchema?.properties || {});
        allToolDescriptions += `- ${tool.name}: ${tool.description} | Args: ${schema}\n`;
      }
    }

    // 1.5 Planner Phase (Dedicated reasoning turn for tool selection)
    let toolPlan = "";
    let allowedTools: Set<string> | null = null;

    if (this.options.planner) {
      if (options.onStep) {
        options.onStep({ type: 'thinking', message: 'Planning tool sequence...' });
      }

      const plannerResponse = await this.llm.chat({
        messages: [
          { role: 'system', content: `You are a Tool Planner. Given a user query and a set of tools, identify the exact sequence of tools needed.
Output ONLY the names of the tools in a comma-separated list, or "NONE" if no tools are needed.

TOOLS:
${allToolDescriptions}` },
          { role: 'user', content: userMessage }
        ]
      });

      const planRaw = plannerResponse.choices[0]?.message?.content || "";
      if (planRaw && !planRaw.includes("NONE")) {
        const toolsInPlan = planRaw.split(',').map(t => t.trim().toLowerCase());
        allowedTools = new Set(toolsInPlan);
        toolPlan = `TOOL PLAN: ${planRaw}`;
        console.log(`[Zentis Planner] Identified sequence: ${planRaw}`);
      }
    }

    // 2. Build Executor System Prompt
    let toolDescriptions = "";
    const keywords = this.options.tool_router ? userMessage.toLowerCase().split(/\s+/) : [];

    if (typeof window !== 'undefined') {
      const isRelevant = allowedTools ? allowedTools.has('get_browser_state') : (!this.options.tool_router || keywords.some(k => 'get_browser_state'.includes(k)));
      if (isRelevant) {
        toolDescriptions += `- get_browser_state: Get current URL, screen size, and theme preference. Args: {}\n`;
        toolToManagerMap['get_browser_state'] = 'native';
      }
    }

    for (const [serverName, tools] of Object.entries(mcpToolsMap)) {
      for (const tool of tools) {
        // Filter by Planner or Router
        if (allowedTools) {
          if (!allowedTools.has(tool.name.toLowerCase())) continue;
        } else if (this.options.tool_router) {
          const content = (tool.name + " " + tool.description).toLowerCase();
          const matches = keywords.some(k => k.length > 2 && content.includes(k));
          if (!matches) continue;
        }

        // Filter out properties that are provided via extraArgs to hide them from the LLM
        const properties = { ...(tool.inputSchema?.properties || {}) };
        if (options.extraArgs) {
          for (const key of Object.keys(options.extraArgs)) {
            delete properties[key];
          }
        }
        
        const schema = JSON.stringify(properties);
        toolDescriptions += `- ${tool.name}: ${tool.description} | Args: ${schema}\n`;
        toolToManagerMap[tool.name] = serverName;
      }
    }

    const toolInstructions = toolDescriptions.length > 0 ? `
AVAILABLE TOOLS:
${toolDescriptions}
TO CALL A TOOL, USE: [CALL:tool_name]{"arg":val}[/CALL]` : "";

    const notes = this.getNotes();
    const systemPrompt = `${notes.join('\n')}\n${toolPlan}\n${toolInstructions}`;

    // 3. Prepare History
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

    // 4. Execution Loop
    let loopCount = 0;
    const maxLoops = 10; 

    while (loopCount < maxLoops) {
      console.log(`\n--- [Loop ${loopCount + 1}/${maxLoops}] ---`);

      if (options.onStep) {
        options.onStep({ type: 'thinking', message: 'Analyzing...', data: { loop: loopCount + 1 } });
      }

      const response = await this.llm.chat({
        messages,
        model: options.model
      });

      const messageContent = response.choices[0]?.message?.content || "";
      console.log(`\n[Zentis Raw LLM Output]:\n${messageContent}\n`);

      // Add assistant message to the context
      messages.push({ role: 'assistant', content: messageContent });

      // Check for prompt-based tool call
      // Pattern: [CALL:get_cameras]{"arg": "val"}[/CALL]
      const toolCallRegex = /\[CALL:([a-zA-Z0-9_-]+)\]([\s\S]*?)\[\/CALL\]/g;
      let match = toolCallRegex.exec(messageContent);

      if (match) {
        const toolName = match[1];
        const argsString = match[2].trim();
        const serverName = toolToManagerMap[toolName];

        let args = {};
        try {
          args = argsString ? JSON.parse(argsString) : {};
        } catch (e) {
          console.warn(`[Zentis JSON Error] Failed to parse tool args: ${argsString}`);
        }

        const extraArgs = options.extraArgs || {};
        const finalArgs = { ...args, ...extraArgs };

        console.log(`\n[Zentis Tool Call]: Calling "${toolName}" on "${serverName || 'UNKNOWN'}" with args:`, finalArgs);

        if (options.onAction) {
          options.onAction({ 
            tool: toolName, 
            args: finalArgs, // Pass merged args to onAction
            server: serverName || 'UNKNOWN', 
            extraArgs: extraArgs 
          });
        }

        if (options.onStep) {
          options.onStep({ type: 'tool_call', message: `Executing ${toolName}...`, data: { tool: toolName } });
        }

        let resultContent = "";
        if (!serverName) {
          resultContent = `{"error": "Tool '${toolName}' does not exist."}`;
        } else {
          try {
            let rawResult;
            if (serverName === 'native' && toolName === 'get_browser_state') {
              rawResult = {
                url: typeof window !== 'undefined' ? window.location.href : '',
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
              };
            } else {
              if (Object.keys(extraArgs).length > 0) {
                console.log(`[Zentis:Debug] Attaching ${Object.keys(extraArgs).length} extraArgs to tool call (hidden from LLM)`);
              }
              rawResult = await this.client.callTool(serverName, toolName, args, extraArgs);
            }

            // Extract structured result if present, otherwise stringify whole response
            const resObj = rawResult as any;
            if (rawResult && typeof rawResult === 'object') {
              const structured = resObj.structuredContent || resObj.structured_content || resObj.data || rawResult;
              const data = (typeof structured === 'object' && structured !== null && ('result' in structured || 'data' in structured))
                  ? (structured.result || structured.data)
                  : structured;
              resultContent = typeof data === 'string' ? data : JSON.stringify(data);
            } else {
              resultContent = String(rawResult);
            }
          } catch (err: any) {
            resultContent = `{"error": "${err.message}"}`;
          }
        }

        console.log(`\n[Zentis Tool Response]: \n${resultContent.substring(0, 500)}${resultContent.length > 500 ? '...[TRUNCATED]' : ''}`);

        if (options.onStep) {
          options.onStep({ type: 'tool_result', message: `Tool ${toolName} finished`, data: { result: resultContent } });
        }

        // Feed result back as system observation (imitating ReAct pattern)
        messages.push({ 
          role: 'user', 
          content: `[RESULT:${toolName}]\n${resultContent}\n[/RESULT]` 
        });

        // Loop continues so LLM can read the result and answer
        loopCount++;

      } else {
        // No tool call requested. We are done.
        console.log(`\n[Zentis] Final Answer Reached.\n`);
        
        const { cleanText, components, actions } = this.parseResponse(messageContent);
        await this.memory.addMessage('assistant', messageContent);

        if (options.onStep) {
          options.onStep({ type: 'complete', message: 'Final response generated', data: { components, actions } });
        }

        return { text: cleanText, components, actions };
      }
    }

    return { text: "Reasoning limit reached. Please try again.", components: [], actions: [] };
  }
}