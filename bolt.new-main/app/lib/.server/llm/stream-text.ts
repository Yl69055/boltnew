import { getClaudeModel } from '~/lib/.server/llm/model';
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
  onFinish?: (result: { text: string; finishReason: string }) => Promise<void>;
};

export async function streamText(messages: Messages, env: Env, options?: StreamingOptions): Promise<ReadableStream<Uint8Array>> {
  const claude = getClaudeModel(env);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        console.log('Sending request to API with messages:', JSON.stringify(messages));
        const response = await claude.createChatCompletion([
          { role: 'system', content: getSystemPrompt() },
          ...messages
        ]);
        console.log('Received API response:', JSON.stringify(response));

        if (response.choices && response.choices.length > 0 && response.choices[0].message) {
          const content = response.choices[0].message.content;
          console.log('Yielding message content:', content);
          controller.enqueue(encoder.encode(content));
          
          if (options?.onFinish) {
            await options.onFinish({ text: content, finishReason: 'stop' });
          }
        } else {
          console.error('未收到预期的响应格式:', JSON.stringify(response));
          throw new Error('API响应格式错误');
        }
      } catch (error) {
        console.error('streamText中发生错误:', error);
        if (error instanceof Error) {
          controller.error(new Error(`AI服务暂时不可用，请稍后再试。详细错误: ${error.message}`));
        } else {
          controller.error(new Error('AI服务暂时不可用，请稍后再试。'));
        }
      } finally {
        controller.close();
      }
    }
  });
}
