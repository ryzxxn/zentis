# Zentis

A high-level agentic framework for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) with built-in memory management and LLM integration.

## Features

- 🚀 **MCP Client**: Connect to multiple MCP servers in parallel (SSE or HTTP).
- 🧠 **Smart Memory**: Persistent history and note-taking system with multi-backend support.
- 🗄️ **Storage Adapters**: Support for **SQLite**, **PostgreSQL**, **IndexedDB**, and **LocalStorage/SessionStorage**.
- 🤖 **Agentic Reasoning**: Multi-turn tool calling with parallel execution.
- 🖼️ **UI Triggers**: Easily trigger browser-side UI components from agent responses.
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

## Quick Start

```typescript
import { ZentisAgent, ZentisMcpClient } from 'zentis';

// 1. Initialize Agent with LLM config & storage
const agent = new ZentisAgent({
  llm: { 
    apiKey: process.env.ZEN_API_KEY, // Or GROQ_API_KEY, OPENAI_API_KEY
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-70b-versatile'
  },
  storage: { type: 'local', userId: 'user_123' }
});

// 2. Connect to MCP Servers
const client = ZentisMcpClient.getInstance();
await client.connect('primary', 'http://localhost:8001/sse');

// 3. Query the agent
const response = await agent.query("Add 56 and 25 using your tools.", {
  onAction: (action) => console.log(`Running ${action.tool} on ${action.server}...`)
});
console.log(response.text);

// Optional: Override model for a specific query
const flashResponse = await agent.query("Quick summary", { model: "llama-3.1-8b-instant" });
```

## Core Concepts

### 1. Multi-Server Connectivity
Zentis uses a singleton `ZentisMcpClient` to manage connections. You can connect to multiple servers in parallel.

```typescript
const client = ZentisMcpClient.getInstance();

// Connect many at once
await client.connectMany([
  { name: 'weather', url: 'http://localhost:8001/sse' },
  { name: 'db', url: 'http://localhost:8002/sse' }
]);

// Check connection status
const isWeatherUp = client.isConnected('weather');
```

### 2. Autonomous Reasoning
The `agent.query()` method doesn't just call a model; it implements a **multi-turn reasoning loop**.
- It fetches available tools from all connected MCP servers.
- It provides the tools to the LLM.
- It executes tool calls (including parallel calls) and feeds results back to the model.
- It repeats until the model provides a final answer.

> **Tip**: Use the `onAction` option to listen for tool executions in real-time.

### 3. Smart Memory & Notes
Zentis maintains a message history and a "notes stack" for persistent context.

#### Notes Stack
Unlike history, notes are sent as part of the system prompt to keep the agent focused. The stack supports multiple data types.
```typescript
await agent.note("User prefers concise answers."); // String
await agent.note({ project: "Zentis", version: "1.0.0" }); // Object
await agent.note(42); // Number

const notes = agent.getNotes();
await agent.popNote(); // Remove last note
```

#### Message History
Messages are automatically persisted to your chosen storage backend.
```typescript
const history = await agent.recall(20); // Get last 20 messages
await agent.clearMemory();              // Wipe memory for current user
```

## Memory & Storage Backends
Zentis supports multiple storage adapters. Configure them via the `storage` option in the `ZentisAgent` constructor.

| Type | Environment | Best For |
| :--- | :--- | :--- |
| `local` / `session` | Browser | Simple persistence, web apps |
| `indexeddb` | Browser | Large histories, offline support |
| `sqlite` | Node.js | Desktop apps, local development |
| `postgres` | Node.js | Scalable production servers |

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
const agent = new ZentisAgent({
  storage: {
    type: 'postgres',
    connectionString: 'postgresql://user:pass@localhost:5432/db',
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
// response.actions -> []
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


### Supported Default Components
- **VideoPlayer**: `{ "url": string, "title": string, "className": string }`
- **Map**: `{ "lat": number, "lng": number, "zoom": number, "className": string }`
- **Chart**: `{ "type": "bar" | "line", "data": any[], "className": string }`
- **Table**: `{ "headers": string[], "rows": any[][], "title": string, "className": string }`


## License

ISC
