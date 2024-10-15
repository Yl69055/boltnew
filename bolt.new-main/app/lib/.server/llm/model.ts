import { getAPIKey } from '~/lib/.server/llm/api-key';
import { env } from 'node:process';

// Custom API client for Claude API
class ClaudeAPI {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  async createChatCompletion(messages: any[]) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: getModel(env as unknown as Env),
        messages: messages
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}

export function getClaudeModel(env: Env) {
  return new ClaudeAPI(
    getAPIKey(env),
    getBaseUrl(env)
  );
}

export function getBaseUrl(cloudflareEnv: Env) {
  return env.OPENAI_API_BASE_URL || cloudflareEnv.OPENAI_API_BASE_URL;
}

export function getModel(cloudflareEnv: Env) {
  return env.OPENAI_API_MODEL || cloudflareEnv.OPENAI_API_MODEL || 'claude-3-5-sonnet-20240620';
}

export async function* streamCompletion(claude: ClaudeAPI, messages: any[], model: string) {
  const response = await claude.createChatCompletion(messages);
  
  if (response.choices && response.choices[0] && response.choices[0].message) {
    yield response.choices[0].message.content;
  }
}
