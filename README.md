# Zentis

A high-level agentic framework for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) with built-in memory management and LLM integration.

## Features

- 🚀 **MCP Client**: Connect to multiple MCP servers in parallel (SSE or HTTP).
- 🧠 **Smart Memory**: Persistent history with **Session ID** support and automatic technical message skipping.
- 🗄️ **Storage Adapters**: Support for **SQLite** and **PostgreSQL** (with SSL) with composite keys.
- 🤖 **Agentic Reasoning**: Multi-turn tool calling with **Enhanced Smart Routing** or **Structured Planning**.
- 🔍 **Dynamic Context Optimization**: Automatically injects a `search_tools` virtual tool when managing 20+ tools to keep LLM context small and fast.
- 🛠️ **Universal Compatibility**: Built-in normalization for **Gemini**, **Groq**, and **OpenRouter**.
- 🛡️ **Recursion Guard**: Prevents infinite tool-calling loops by tracking and blocking redundant calls with identical arguments.
- ⚡ **Batch Tool Execution**: Execute multiple tools in parallel within a single reasoning turn for high-performance workflows.
- 📋 **Planning Phase**: Optional dedicated LLM turn to pre-select tool sequences using JSON-based verification, improving accuracy for complex tasks.
- 🎨 **Smarter UI Rendering**: Register custom UI components (Table, Charts, etc.) that automatically resolve large datasets from hidden data references.

## Installation

```bash
npm install zentis
```

*Note: If using SQLite or Postgres, install the respective drivers:*
```bash
npm install better-sqlite3 # for SQLite
npm install pg             # for PostgreSQL
```

## Agent Configuration

The `ZentisAgent` is highly configurable to balance between reasoning depth and performance.

```typescript
const agent = new ZentisAgent({
  // Tool Routing & Planning
  tool_router: true, // Filters tools sent to LLM based on query keywords
  planner: true,     // Uses a separate LLM turn to pre-plan the required tools
  
  // Performance & Loops
  maxTurns: 15,      // Max reasoning loops (default 10, range 1-50)
  maxHistoryMessages: 30, // Number of history messages to keep in context
  
  // LLM Config
  llm: {
    apiKey: '...',
    model: 'gemini-3-flash-preview'
  },

  // MCP Servers
  mcp: [
    { name: 'Analytics', url: 'https://mcp-analytics.example.com/sse' },
    { name: 'Database', url: 'http://localhost:3001/mcp' }
  ]
});
```

### Context Size Optimization (Dynamic Search Tool)
When connecting to many MCP servers, the tool definitions can easily exceed the LLM's context window or make it slow/expensive. 

Zentis automatically optimizes this:
1. **Under 20 Tools**: All tool definitions are sent to the LLM.
2. **Over 20 Tools**: Zentis hides most tools and injects a `search_tools` virtual tool. The LLM can use this to find the exact tools it needs, which are then injected into the context dynamically for subsequent turns.

## UI Component Integration (React)

Zentis allows you to register UI components that the LLM can trigger. These components automatically handle large datasets by swapping background "Data References" for actual props before the response is returned.

### 1. Register Components (Node.js/Agent side)

Zentis uses a central `ZentisUI` registry to define which components the LLM is allowed to use. By default, `Table`, `Chart`, and `Graph` are pre-registered.

```typescript
import { ZentisAgent, ZentisUI } from 'zentis';

const ui = new ZentisUI();

// Register a custom component
ui.register({
  name: 'SalesChart',
  description: 'Display sales trends and forecasts.',
  props: {
    region: { type: 'string', description: 'Region name', required: true },
    revenue: { type: 'number', description: 'Current revenue' },
    isProfitable: { type: 'boolean', description: 'Whether the region is profitable' },
    forecast: { 
      type: 'data_reference', 
      description: 'Reference to the sales forecast data list from a tool' 
    },
    filters: {
      type: 'object',
      description: 'Dynamic filters to apply to the data'
    }
  }
});

const agent = new ZentisAgent({ ui, ... });
```

#### Property Types
- `string`, `number`, `boolean`, `array`, `object`: Standard JSON types.
- `data_reference`: **Crucial for performance.** This tells the LLM to provide a Result ID (e.g., `res_1_get_sales`) instead of the raw data. Zentis will automatically swap this ID for the actual data before returning the response to your frontend.

### 2. Usage in React (Frontend side)

In your React application, you can map the registered components to your actual UI library. Zentis automatically resolves `data_reference` IDs into actual data arrays before returning the response.

```tsx
import React from 'react';
import { AgentResponse } from 'zentis';

// Example UI Component Map
const ComponentMap = {
  SalesChart: ({ region, revenue, forecast }: any) => (
    <div className="p-4 border rounded shadow">
      <h2>Sales in {region}</h2>
      <p className="text-2xl font-bold">${revenue}</p>
      {forecast && (
        <ul className="mt-2 text-sm">
          {forecast.map((f: any, i: number) => (
            <li key={i}>{f.period}: ${f.amount}</li>
          ))}
        </ul>
      )}
    </div>
  ),
  Table: ({ title, data, filters }: any) => {
    // Apply dynamic filters generated by the LLM
    const filteredData = React.useMemo(() => {
      if (!filters) return data;
      return data.filter((row: any) => 
        Object.entries(filters).every(([key, val]) => String(row[key]) === String(val))
      );
    }, [data, filters]);

    return (
      <div className="overflow-x-auto">
        <h3 className="mb-2 font-semibold">{title}</h3>
        <table className="min-w-full border text-sm">
          <thead>
            <tr className="bg-gray-100">
              {Object.keys(filteredData[0] || {}).map(k => <th key={k} className="border p-2">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredData.map((row: any, i: number) => (
              <tr key={i}>
                {Object.values(row).map((v: any, j) => <td key={j} className="border p-2">{String(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
};

export const ZentisChatView = () => {
  const [response, setResponse] = React.useState<AgentResponse | null>(null);

  const handleQuery = async (text: string) => {
    // res.components[0].props.forecast is already populated with the full dataset
    // thanks to Zentis' automatic resolution of data_reference types.
    const res = await agent.query(text);
    setResponse(res);
  };

  return (
    <div className="p-4 space-y-4">
      {/* 1. Render the Conversational Text */}
      {response && <p className="text-gray-800">{response.text}</p>}

      {/* 2. Render Auto-populated UI Components */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {response?.components.map((comp, i) => {
          const Renderer = ComponentMap[comp.name as keyof typeof ComponentMap];
          return Renderer ? <Renderer key={i} {...comp.props} /> : null;
        })}
      </div>
    </div>
  );
};
```

## Quick Start

```typescript
import { ZentisAgent, ZentisMcpClient } from 'zentis';

// 1. Initialize Agent with LLM, Storage, and MCP configs
const agent = new ZentisAgent({
  llm: { 
    apiKey: process.env.ZEN_API_KEY || process.env.GEMINI_API_KEY,
    baseURL: process.env.ZEN_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: process.env.ZEN_MODEL || 'gemini-3-flash-preview'
  },
  storage: { 
    type: 'sqlite', 
    connectionString: process.env.DB_CONNECTION_URL || 'zentis.db',
    userId: 'user_123',
    sessionId: 'session_abc' // Optional: Scope history to a specific session
  },
  mcp: { 
    name: 'primary', 
    url: 'http://localhost:8001/sse'
  },
  tool_router: true,         // Enable internal tool routing to avoid prompt bloat
  maxHistoryMessages: 10     // Set a custom sliding window for history
});

// 2. Query the agent with real-time lifecycle hooks
// ALWAYS call waitReady() before querying to ensure all MCP servers are connected
await agent.waitReady();

const response = await agent.query("Check the status of the inventory levels", {
  onStep: (step) => {
    console.log(`[${step.type}] ${step.message}`);
    if (step.data) console.log('Data:', step.data);
  },
  onAction: (action) => {
    console.log(`Executing ${action.tool} on ${action.server}`);
  },
  extraArgs: {
    API_auth: 'your-frontend-token-here'
  }
});

// Optional: Override model for a specific query
const flashResponse = await agent.query("Quick summary", { model: "llama-3.1-8b-instant" });
```

## Core Concepts

### 1. Multi-Server Connectivity
Zentis uses a singleton `ZentisMcpClient` to manage connections. You can connect to multiple servers in parallel, each with its own transport and authentication settings.

```typescript
const client = ZentisMcpClient.getInstance();

await client.connectMany([
  { 
    name: 'analytics', 
    url: 'https://api.analytics.com/mcp',
    options: { 
      transportType: 'sse', 
      headers: { 'Authorization': process.env.MCP_TOKEN } 
    }
  },
  { 
    name: 'local-tools', 
    url: 'http://localhost:8080/mcp',
    options: { transportType: 'http' }
  }
]);

// Tools from ALL servers are automatically available to the agent
const tools = await agent.listAvailableTools();
```

### 2. Autonomous Reasoning & Dynamic Tools
Zentis implements a **multi-turn reasoning loop** with optional perception and planning layers. 

#### Dynamic Context Optimization (search_tools)
When connecting to many MCP servers, the tool definitions can easily exceed the LLM's context window. Zentis automatically optimizes this:
- **Small context**: Under 20 tools, all definitions are sent to the LLM.
- **Large context**: Over 20 tools, Zentis hides most tools and injects a `search_tools` virtual tool. The LLM uses this to find the exact tools it needs, which are then injected into the context dynamically for subsequent turns.

```typescript
const agent = new ZentisAgent({
  // ...
  tool_router: true,  // Perception: keyword-based tool filtering
  planner: true       // Planning: dedicated LLM turn to pre-select tools
});
```

- **Smart Tool Routing**: If `tool_router` is enabled, Zentis uses regex heuristics to inject only the most relevant tools into the prompt, preventing "tool noise" and saving context window.
- **Batch Execution**: Zentis supports executing multiple tools in a single turn. If an LLM emits multiple `[CALL:...]` tags, Zentis runs them all in parallel.
- **Recursion Guard**: To ensure stability, Zentis tracks every tool call. If the agent attempts to call the exact same tool with identical arguments twice, Zentis blocks it to prevent infinite loops.

### 3. Observability & Event Lifecycle
Zentis provides deep visibility into the agent's reasoning loop. You can use `onStep` to build real-time "Thinking..." UIs or audit logs.

```typescript
const response = await agent.query("Analyze the sales for Q1", {
  onStep: (step) => {
    switch (step.type) {
      case 'thinking':
        console.log("🤔 Agent is thinking:", step.message);
        break;
      case 'tool_call':
        console.log(`🛠️ Calling tool: ${step.data.tool}`);
        break;
      case 'tool_result':
        console.log("✅ Tool returned data");
        break;
      case 'complete':
        console.log("🏁 Agent finished reasoning");
        break;
    }
  },
  onAction: (action) => {
    // Fired just before a tool is executed
    console.log(`Executing ${action.tool} with args:`, action.args);
  }
});
```

### 4. Smart Memory & Custom Personas (Zero-Identity)
Zentis avoids "library bloat" by not injecting any hardcoded identity, instructions, or UI help. This **Zero-Identity Architecture** gives you full control. Use the "notes stack" to define your agent's persona and rules.

```typescript
// Define Identity
await agent.note("You are a helpful Personal Assistant named Zen."); 
await agent.note("You have access to the primary MCP server.");

// Define Operational Rules
await agent.note("If multiple records are found, always list their status in a [UI:Table].");
await agent.note("ALWAYS respond in a professional tone.");

// The agent's core 'system prompt' is built from these notes.
const currentInstructions = agent.getNotes();
```

#### Multi-Turn Planning
You can use notes to guide the planning phase as well:
```typescript
await agent.note("Before using any tools, explain your plan to the user briefly.");
```

### 5. Extra Arguments (Sensitive Tokens)
Zentis allows you to pass custom arguments (like auth tokens or session IDs) directly to your tools without exposing them to the LLM. These are passed via the `extraArgs` option in the `query` method.

```typescript
const response = await agent.query("Get my records", {
  extraArgs: {
    API_auth: "eyJhbGciOi...", // Hidden from LLM
    nodeId: 101
  }
});
```

**How it works:**
1. **Schema Scrubbing**: Zentis removes `API_auth` and `nodeId` from the tool definition before sending it to the LLM. The LLM doesn't even know these parameters exist.
2. **Automatic Injection**: When the LLM calls the tool, Zentis automatically injects your `extraArgs` into the arguments before execution.
3. **Security**: Prevents the LLM from hallucinating or attempting to manipulate sensitive session/auth parameters.

### 6. Multi-Turn Session Isolation
Zentis uses a **composite key** (`userId` + `sessionId`) to ensure strict isolation across parallel conversations. This allows you to maintain multiple independent chat sessions for the same user.

```typescript
// Session A
const agentA = new ZentisAgent({
  storage: { type: 'sqlite', userId: 'user_1', sessionId: 'session_A' }
});
await agentA.query("My name is Alice");

// Session B
const agentB = new ZentisAgent({
  storage: { type: 'sqlite', userId: 'user_1', sessionId: 'session_B' }
});
const res = await agentB.query("What is my name?"); 
// res.text -> "I don't know your name yet."
```

## Memory & Storage Backends
Zentis supports multiple storage adapters. Configure them via the `storage` option in the `ZentisAgent` constructor. All backends use a **composite key** (`userId` + `sessionId`) to ensure strict **session isolation** across parallel conversations.

| Type | Environment | Isolation | Key Features |
| :--- | :--- | :--- | :--- |
| `sqlite` | Node.js | Composite PK | Fast, file-based persistence |
| `postgres` | Node.js | Composite PK | Scalable, **SSL-ready** storage |

### Examples

**SQLite (Node.js)**
```typescript
const agent = new ZentisAgent({
  storage: {
    type: 'sqlite',
    connectionString: './data.db', // default: 'zentis.db'
    userId: 'user_789'
  }
});
```

**PostgreSQL (Node.js)**
```typescript
// Option 1: Connection String
const agent = new ZentisAgent({
  storage: {
    type: 'postgres',
    connectionString: 'postgresql://user:pass@localhost:5432/db',
    ssl: { rejectUnauthorized: false }, 
    userId: 'user_999'
  }
});

// Option 2: Existing PG Pool Instance
import { Pool } from 'pg';
const myPool = new Pool({ ... });

const agent = new ZentisAgent({
  storage: {
    type: 'postgres',
    pool: myPool, // Pass your own pre-configured pool
    userId: 'user_999'
  }
});
```

## UI Components (Browser Integration)
Agents can "trigger" UI components in the frontend. Zentis automatically parses these into a structured `components` array.

### Syntax
The agent should respond with: `[UI:ComponentName]{"props": "here"}[/UI]`.

### Usage
```typescript
const response = await agent.query("Show me the map of London");

// response.text -> "Here is the map you requested:"
// response.components -> [{ name: "Map", props: { lat: 51.5, lng: -0.12 } }]
```

### Frontend Integration (React Example)
You can easily map Zentis components to your own UI library:

```tsx
const ChatMessage = ({ response }) => {
  return (
    <div>
      <p>{response.text}</p>
      
      {response.components.map((comp, i) => {
        switch(comp.name) {
          case 'Map': return <MyMap key={i} {...comp.props} />;
          case 'VideoPlayer': return <MyVideo key={i} {...comp.props} />;
          case 'Table': return <MyTable key={i} {...comp.props} />;
          default: return null;
        }
      })}
    </div>
  );
};
```

## Token & Tool Optimization
Zentis is built for production efficiency.

### 1. Smart History Optimization
To keep storage clean and token usage low, Zentis **only saves final responses** and user queries to permanent storage. Intermediate tool calls and raw results are kept in memory only for the duration of the current reasoning loop.

### Supported Default Components
- **VideoPlayer**: `{ "url": string, "title": string, "className": string, "fullWidth": boolean }`
- **Map**: `{ "lat": number, "lng": number, "zoom": number, "className": string, "fullWidth": boolean }`
- **Chart**: `{ "type": "bar" | "line", "data": any[], "className": string, "fullWidth": boolean }`
- **Table**: `{ "headers": string[], "rows": any[][], "title": string, "className": string, "fullWidth": boolean }`


## License

ISC
