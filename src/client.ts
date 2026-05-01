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

  private constructor() {}

  /**
   * Get the singleton instance of ZentisMcpClient
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
   * @returns A map of server names to their available tools
   */
  async listTools(serverName?: string): Promise<Record<string, ListToolsResult['tools']>> {
    const results: Record<string, ListToolsResult['tools']> = {};

    if (serverName) {
      const server = this.servers.get(serverName);
      if (!server) {
        throw new Error(`Server "${serverName}" not found. Connect it first.`);
      }
      const response = await server.client.listTools();
      results[serverName] = response.tools;
    } else {
      const promises = Array.from(this.servers.entries()).map(async ([name, server]) => {
        try {
          const response = await server.client.listTools();
          results[name] = response.tools;
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
    console.log(`[Zentis:MCP] Calling "${toolName}" on "${serverName}" with:`, JSON.stringify(finalArgs, null, 2));
    const result = await server.client.callTool({
      name: toolName,
      arguments: finalArgs
    });
    console.log(`[Zentis:MCP] Result from "${toolName}":`, JSON.stringify(result, null, 2));
    return result;
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
