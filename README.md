# Zentis

A high-level agentic framework for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) with built-in memory management and LLM integration.

## Features

- 🚀 **MCP Client**: Connect to multiple MCP servers in parallel (SSE or HTTP).
- 🧠 **Smart Memory**: Persistent history with **Session ID** support and automatic technical message skipping.
- 🗄️ **Storage Adapters**: Support for **SQLite**, **PostgreSQL** (with SSL), **IndexedDB**, and **LocalStorage** with composite keys.
- 🤖 **Agentic Reasoning**: Multi-turn tool calling with **Regex-based Smart Routing** or **LLM-based Planning**.
- 🛠️ **Universal Compatibility**: Built-in normalization for **Gemini**, **Groq**, and **OpenRouter**.
- 📋 **Planning Phase**: Optional dedicated LLM turn to pre-select tool sequences, improving accuracy for complex tasks.
- 🌐 **Universal**: Runs in both Node.js and Browser environments.

## Installation

```bash
npm install zentis
```

*Note: If using SQLite or Postgres, install the respective drivers:*
```bash
npm install better-sqlite3 # for SQLite
npm install pg             # for PostgreSQL
```

## Browser Usage

Zentis can be used directly in the browser via a script tag or modern bundlers.

### Script Tag
```html
<script src="dist/zentis.bundle.js"></script>
<script>
  const agent = new Zentis.ZentisAgent({
    llm: { apiKey: '...', model: 'gemini-3-flash-preview' },
    storage: { type: 'indexeddb', dbName: 'zentis_app' }
  });
</script>
```

### ES Modules
```typescript
import { ZentisAgent } from 'zentis';

const agent = new ZentisAgent({
  storage: { type: 'local', keyPrefix: 'my_app_' }
});
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

const response = await agent.query("Check the status of the front yard camera", {
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

### 2. Autonomous Reasoning
The `agent.query()` method implements a **multi-turn reasoning loop**. You can control how the agent perceives and plans its actions:

```typescript
const agent = new ZentisAgent({
  // ...
  tool_router: true, // Enable keyword-based tool filtering (saves tokens)
  planner: true,     // Enable dedicated planning turn (improves accuracy)
});
```

- **Smart Routing**: If `tool_router: true`, Zentis uses regex heuristics to prioritize the most relevant tools based on the query.
- **Planner Phase (Experimental)**: If `planner: true`, Zentis runs a dedicated LLM turn to pre-select the optimal sequence of tools. This reduces prompt noise and improves accuracy for multi-step tasks.
- **Provider Normalization**: Automatically fixes schema and message format issues for strict providers like Google Gemini.
- **Observability**: Use `onStep` to track thinking, tool calls, and results in real-time.

> **Tip**: Zentis automatically sanitizes tool call IDs and patches schemas to ensure compatibility with strict providers like Gemini/Google.

> **Tip**: Use the `onAction` option to listen for tool executions in real-time.

### 3. Smart Memory & Custom Personas (Zero-Identity)
Zentis avoids "library bloat" by not injecting any hardcoded identity, instructions, or UI help. This **Zero-Identity Architecture** gives you full control. Use the "notes stack" to define your agent's persona and rules.

```typescript
// Define Identity
await agent.note("You are a helpful Security Assistant named Sentinel."); 
await agent.note("You have access to the Sherlock MCP server.");

// Define Operational Rules
await agent.note("If multiple cameras are found, always list their status in a [UI:Table].");
await agent.note("ALWAYS respond in a professional tone.");

// The agent's core 'system prompt' is built from these notes.
const currentInstructions = agent.getNotes();
```

#### Multi-Turn Planning
You can use notes to guide the planning phase as well:
```typescript
await agent.note("Before using any tools, explain your plan to the user briefly.");
```

### 4. Extra Arguments (Sensitive Tokens)
Zentis allows you to pass custom arguments (like auth tokens or session IDs) directly to your tools without exposing them to the LLM. These are passed via the `extraArgs` option in the `query` method.

```typescript
const response = await agent.query("Get my cameras", {
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

- **Strict Overriding**: `extraArgs` always take precedence.
- **Flexibility**: You can name the keys anything and set their types to any valid JSON value.

## Memory & Storage Backends
Zentis supports multiple storage adapters. Configure them via the `storage` option in the `ZentisAgent` constructor. All backends use a **composite key** (`userId` + `sessionId`) to ensure strict **session isolation** across parallel conversations.

| Type | Environment | Isolation | Key Features |
| :--- | :--- | :--- | :--- |
| `local` / `session` | Browser | Per User/Session | Simple key-value persistence |
| `indexeddb` | Browser | Composite KeyPath | Structured browser storage |
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

## UI Actions (Web API)
Zentis allows the agent to interact with the frontend by triggering specific actions like highlighting, clicking, or focusing elements.

### Syntax
`[ACTION:Type]{"targetId": "element-id", "metadata": {}}[/ACTION]`

### Example
```typescript
const response = await agent.query("Highlight the submit button");

// response.actions -> [{ type: "highlight", targetId: "submit-btn" }]
```

### Supported Actions
- **highlight**: Focus attention on a specific element.
- **click**: Trigger a programmatic click.
- **focus**: Set focus to an input field.
- **scroll**: Scroll an element into view.
- **custom**: Pass arbitrary events to your frontend.

## Token & Tool Optimization
Zentis is built for production efficiency.

### 1. Smart History Optimization
To keep storage clean and token usage low, Zentis **only saves final responses** and user queries to permanent storage. Intermediate tool calls and raw results are kept in memory only for the duration of the current reasoning loop.

### 2. Structured Content Extraction
Zentis automatically detects and extracts clean data from tool responses. It prioritizes keys like `structuredContent`, `structured_content`, or `data`, discarding redundant UI metadata before sending context back to the LLM.

### 3. Native Browser Tools
When running in a browser, Zentis injects tools that don't require a server:
- **`get_browser_state`**: Viewport size, current URL, theme (dark/light), etc.


### Supported Default Components
- **DetectionGallery**: `{ "title": string, "data": any[] }`
- **VideoPlayer**: `{ "url": string, "title": string, "className": string }`
- **Map**: `{ "lat": number, "lng": number, "zoom": number, "className": string }`
- **Chart**: `{ "type": "bar" | "line", "data": any[], "className": string }`
- **Table**: `{ "headers": string[], "rows": any[][], "title": string, "className": string }`


## License

ISC
