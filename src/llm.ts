import OpenAI from 'openai';
import type { LLMConfig } from './types.js';

export class ZentisLlmClient {
  public openai: OpenAI;
  public defaultModel: string;

  constructor(config: LLMConfig) {
    const env = typeof process !== 'undefined' ? process.env : {};
    const apiKey = config.apiKey || (env as any).ZEN_API_KEY || (env as any).GEMINI_API_KEY || (env as any).GROQ_API_KEY || (env as any).OPENAI_API_KEY || (env as any).OPENROUTER_API_KEY;
    const baseURL = config.baseURL || (env as any).ZEN_BASE_URL;
    const model = config.model || (env as any).ZEN_MODEL || "llama-3.1-8b-instant";
    
    if (!apiKey) {
      throw new Error("ZentisLlmClient: apiKey must be provided in config or via environment variables");
    }

    this.openai = new OpenAI({
      apiKey,
      baseURL: baseURL, 
      dangerouslyAllowBrowser: true 
    });
    this.defaultModel = model;
  }

  async chat(options: { 
    messages: OpenAI.Chat.ChatCompletionMessageParam[]; 
    model?: string;
  }) {
    const messages = this.prepareMessages(options.messages);
    
    const payload = {
      model: options.model || this.defaultModel,
      messages,
      // Intentionally NOT passing tools or tool_choice to force prompt-based execution
    };

    console.log('\n[Zentis:LLM] Sending Payload:', JSON.stringify(payload, null, 2));

    const response = await this.openai.chat.completions.create(payload);

    console.log('\n[Zentis:LLM] Raw Response Received:', JSON.stringify(response, null, 2));
    return response;
  }

  private prepareMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      const normalized = { ...msg };
      
      // Ensure pure text communication
      if (typeof normalized.content !== 'string') {
        normalized.content = String(normalized.content || "");
      }

      // Clean up internal properties that shouldn't go to the LLM API
      delete (normalized as any).component;
      delete (normalized as any).metadata;
      delete (normalized as any).timestamp;
      delete (normalized as any).extra_content;

      return normalized;
    });
  }

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

  async testConnection(options: { model?: string; input: string }) {
    return await this.responses.create(options);
  }
}