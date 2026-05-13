import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/client';
import type { ServerConnection, ConnectionOptions } from './types.js';

/**
 * Zentis MCP Client
 * Manages connections to one or multiple MCP servers and provides
 * simplified methods to interact with their tools.
 */
export class ZentisMcpClient {
  private static instance: ZentisMcpClient;
  private servers: Map<string, ServerConnection> = new Map();
  private toolsCache: Map<string, { tools: ListToolsResult['tools']; timestamp: number }> = new Map();
  private CACHE_TTL = 30000; // 30 seconds

  constructor() {}

  /**
   * Get the singleton instance of ZentisMcpClient
   * @deprecated Use new ZentisMcpClient() for isolated instances
   */
  public static getInstance(): ZentisMcpClient {
    if (!ZentisMcpClient.instance) {
      ZentisMcpClient.instance = new ZentisMcpClient();
    }
    return ZentisMcpClient.instance;
  }

  /**
   * Connect to an MCP server via HTTP
   * @param name Unique name for the server connection
   * @param url The server's MCP endpoint URL
   * @param options Connection options
   */
  async connect(name: string, url: string, options: ConnectionOptions = {}): Promise<boolean> {
    const client = new Client({
      name: `zentis-${name}`,
      version: '1.0.0'
    });

    client.onerror = (error) => {
      if (!options.silent) {
        console.error(`[Zentis] Background error on ${name}:`, error.message || error);
      }
    };

    if (options.onNotification) {
      client.setNotificationHandler('notifications/message', options.onNotification);
    }

    // Close existing connection if it exists for this name to prevent memory leak
    const existing = this.servers.get(name);
    if (existing) {
      try {
        await existing.transport.close();
      } catch (e) {
        // Ignore close errors
      }
    }

    try {
      let transport;
      if (options.transportType === 'http') {
        const transportParams: any = {};
        if (options.headers) {
          transportParams.requestInit = { headers: options.headers };
        }
        transport = new StreamableHTTPClientTransport(new URL(url), transportParams);
      } else {
        const transportParams: any = {};
        if (options.headers) {
          transportParams.requestInit = { headers: options.headers };
          transportParams.eventSourceInit = { headers: options.headers };
        }
        transport = new SSEClientTransport(new URL(url), transportParams);
      }

      await client.connect(transport);
      this.servers.set(name, { client, transport });
      this.toolsCache.delete(name); // Invalidate cache on new connection
      return true;
    } catch (error) {
      if (!options.silent) {
        console.error(`[Zentis] Failed to connect to ${name} at ${url}. Is the server running?`);
      }
      return false;
    }
  }

  /**
   * Connect to multiple MCP servers in parallel
   */
  async connectMany(configs: { name: string; url: string; options?: ConnectionOptions }[]): Promise<Record<string, boolean>> {
    const promises = configs.map(config => 
      this.connect(config.name, config.url, config.options).then(success => ({ name: config.name, success }))
    );
    
    const results = await Promise.all(promises);
    return results.reduce((acc, { name, success }) => ({ ...acc, [name]: success }), {});
  }

  /**
   * Check if a specific server is connected
   */
  isConnected(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * List tools available on one or all connected servers
   * @param serverName Optional specific server to list tools from
   * @param forceRefresh Ignore cache and fetch fresh tool list
   * @returns A map of server names to their available tools
   */
  async listTools(serverName?: string, forceRefresh: boolean = false): Promise<Record<string, ListToolsResult['tools']>> {
    const results: Record<string, ListToolsResult['tools']> = {};
    const timeoutMs = 10000;

    const fetchWithTimeout = async (name: string, client: Client) => {
      // Check cache first
      if (!forceRefresh) {
        const cached = this.toolsCache.get(name);
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
          return cached.tools;
        }
      }

      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`listTools for ${name} timed out`)), timeoutMs);
      });
      try {
        const response = await Promise.race([
          client.listTools(),
          timeoutPromise
        ]);
        const tools = (response as ListToolsResult).tools;
        this.toolsCache.set(name, { tools, timestamp: Date.now() });
        return tools;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    if (serverName) {
      const server = this.servers.get(serverName);
      if (!server) {
        throw new Error(`Server "${serverName}" not found. Connect it first.`);
      }
      try {
        results[serverName] = await fetchWithTimeout(serverName, server.client);
      } catch (error) {
        console.error(`Failed to list tools for server ${serverName}:`, error);
        results[serverName] = [];
      }
    } else {
      const promises = Array.from(this.servers.entries()).map(async ([name, server]) => {
        try {
          results[name] = await fetchWithTimeout(name, server.client);
        } catch (error) {
          console.error(`Failed to list tools for server ${name}:`, error);
          results[name] = [];
        }
      });
      await Promise.all(promises);
    }

    return results;
  }

  /**
   * Call a specific tool on a specific server
   * @param serverName The name of the server where the tool is located
   * @param toolName The name of the tool to call
   * @param args Arguments for the tool call
   * @param extraArgs Optional sensitive extra arguments (e.g. tokens) that should not be logged
   */
  async callTool(
    serverName: string, 
    toolName: string, 
    args: Record<string, any> = {},
    extraArgs: Record<string, any> = {}
  ): Promise<CallToolResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server "${serverName}" not found. Connect it first.`);
    }

    const finalArgs = { ...args, ...extraArgs };
    
    // Add a timeout to tool calls to prevent hanging queries from leaking memory
    const timeoutMs = 30000;
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Tool call to ${toolName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      const result = await Promise.race([
        server.client.callTool({
          name: toolName,
          arguments: finalArgs
        }),
        timeoutPromise
      ]);
      return result as CallToolResult;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Disconnect from all servers and clean up resources
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.servers.values()).map(s => s.transport.close());
    await Promise.all(promises);
    this.servers.clear();
  }

  getServer(name: string): Client | undefined {
    return this.servers.get(name)?.client;
  }
}
