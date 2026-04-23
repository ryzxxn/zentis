import OpenAI from 'openai';

export interface LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * Zentis LLM Client
 * Wrapper around OpenAI SDK for easy integration with various providers (Groq, OpenAI, etc.)
 */
export class ZentisLlmClient {
  public openai: OpenAI;
  public defaultModel: string;

  constructor(config: LLMConfig) {
    const env = typeof process !== 'undefined' ? process.env : {};
    const apiKey = config.apiKey || (env as any).ZEN_API_KEY || (env as any).GROQ_API_KEY || (env as any).OPENAI_API_KEY || (env as any).OPENROUTER_API_KEY;
    
    if (!apiKey) {
      throw new Error("ZentisLlmClient: apiKey must be provided in config or via environment variables");
    }

    this.openai = new OpenAI({
      apiKey,
      baseURL: config.baseURL, 
      dangerouslyAllowBrowser: true 
    });
    this.defaultModel = config.model || "llama-3.1-8b-instant";
  }

  /**
   * Standard chat completion with support for tools
   */
  async chat(options: { 
    messages: OpenAI.Chat.ChatCompletionMessageParam[]; 
    tools?: OpenAI.Chat.ChatCompletionTool[];
    tool_choice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
    model?: string;
  }) {
    return await this.openai.chat.completions.create({
      messages: options.messages,
      tools: options.tools,
      tool_choice: options.tool_choice,
      model: options.model || this.defaultModel,
    });
  }

  /**
   * Proxy to allow user's requested syntax: client.responses.create()
   */
  get responses() {
    return {
      create: async (options: { model?: string; input: string }) => {
        const response = await this.chat({
          messages: [{ role: 'user', content: options.input }],
          model: options.model
        });
        return {
          output_text: response.choices[0]?.message?.content || ""
        };
      }
    };
  }

  /**
   * Test the LLM connection
   */
  async testConnection(options: { model?: string; input: string }) {
    return await this.responses.create(options);
  }
}
