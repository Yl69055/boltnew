import OpenAI from 'openai';
import { getOpenAIModel } from '~/lib/.server/llm/model';
import { MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export type StreamingOptions = {
  temperature?: number;
  maxTokens?: number;
};

export async function* streamText(messages: Messages, env: Env, options?: StreamingOptions) {
  const openai = getOpenAIModel(env);
  try {
    const stream = await openai.chat.completions.create({
      model: env.OPENAI_API_MODEL || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: getSystemPrompt() },
        ...messages
      ],
      max_tokens: options?.maxTokens || MAX_TOKENS,
      temperature: options?.temperature || 0.7,
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        yield chunk.choices[0].delta.content;
      }
    }
  } catch (error) {
    console.error('Error in streamText:', error);
    throw error;
  }
}
