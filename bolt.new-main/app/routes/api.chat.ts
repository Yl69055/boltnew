import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';

const MAX_TOKENS = 2048;
const MAX_RESPONSE_SEGMENTS = 5;
const CONTINUE_PROMPT = "Please continue from where you left off.";

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages } = await request.json<{ messages: Messages }>();

  const stream = new SwitchableStream();

  try {
    const options: StreamingOptions = {
      maxTokens: MAX_TOKENS,
      temperature: 0.7,
    };

    const encoder = new TextEncoder();

    async function* generateStream(messages: Messages) {
      for await (const chunk of streamText(messages, context.cloudflare.env, options)) {
        yield encoder.encode(chunk);
      }
    }

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of generateStream(messages)) {
            controller.enqueue(chunk);
          }
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Chat action error:', error);

    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
