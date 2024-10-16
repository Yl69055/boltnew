import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  console.log('Received chat action request');

  // 添加 CORS 头
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  // 处理 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    const { messages } = await request.json<{ messages: Messages }>();
    console.log('Received messages:', JSON.stringify(messages));

    const stream = new SwitchableStream();

    const options: StreamingOptions = {
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(messages, context.cloudflare.env, options);

        return stream.switchSource(result);
      },
    };

    const result = await streamText(messages, context.cloudflare.env, options);

    stream.switchSource(result);

    headers.set('Content-Type', 'text/plain; charset=utf-8');

    return new Response(stream.readable, { status: 200, headers });
  } catch (error) {
    console.error('Error in chatAction:', error);

    headers.set('Content-Type', 'application/json');

    return new Response(
      JSON.stringify({ error: 'An error occurred while processing your request' }),
      { status: 500, headers }
    );
  }
}
