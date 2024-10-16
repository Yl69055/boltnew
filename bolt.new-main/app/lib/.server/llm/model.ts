import { getAPIKey } from '~/lib/.server/llm/api-key';
import { env } from 'node:process';

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

// Custom API client for Claude API
class ClaudeAPI {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  async createChatCompletion(messages: any[]): Promise<ChatCompletionResponse> {
    const maxRetries = 5; // 增加重试次数
    let retries = 0;

    while (retries < maxRetries) {
      try {
        console.log(`尝试API请求，重试次数: ${retries}`);
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
          console.error(`API请求失败，状态码: ${response.status}`);
          if (response.status === 503 || response.status === 500) {
            console.error(`服务器错误 (${response.status})，尝试重试 ${retries + 1}/${maxRetries}`);
            retries++;
            await new Promise(resolve => setTimeout(resolve, 2000 * retries)); // 增加等待时间
            continue;
          }
          throw new Error(`HTTP错误！状态码: ${response.status}`);
        }

        const responseData = await response.json() as ChatCompletionResponse;
        console.log('API请求成功，收到响应');
        return responseData;
      } catch (error) {
        console.error('API请求出错:', error);
        if (retries === maxRetries - 1) {
          throw error;
        }
        retries++;
        await new Promise(resolve => setTimeout(resolve, 2000 * retries));
      }
    }

    throw new Error('超过最大重试次数');
  }
}

export function getClaudeModel(env: Env) {
  const apiKey = getAPIKey(env);
  const baseUrl = getBaseUrl(env);

  if (!apiKey || !baseUrl) {
    throw new Error('API密钥或基础URL未正确配置');
  }

  return new ClaudeAPI(apiKey, baseUrl);
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
