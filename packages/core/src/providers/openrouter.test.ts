import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatTool } from '../types';
import type { TraceEvent } from '../chat/trace';
import {
  createOpenRouterEmbedder,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterProvider,
} from './openrouter';

// A local stand-in for OpenRouter's /chat/completions endpoint.
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler;
let baseURL: string;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (data: Buffer) => (body += data.toString()));
  req.on('end', () => handler(req, body, res));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function sendEvents(res: ServerResponse, events: string[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const event of events) res.write(event);
  res.end();
}

function event(fields: object): string {
  const chunk = { id: 'gen-1', object: 'chat.completion.chunk', created: 0, model: 'm', ...fields };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function delta(delta: object, finish_reason: string | null = null): string {
  return event({ choices: [{ index: 0, delta, finish_reason }] });
}

async function collect(chunks: AsyncIterable<string>, into: string[] = []): Promise<string> {
  for await (const chunk of chunks) into.push(chunk);
  return into.join('');
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'hi' },
];

describe('OpenRouterProvider', () => {
  const provider = () => new OpenRouterProvider({ apiKey: 'sk-test', baseURL });

  it('sends an authenticated streaming request for the default model', async () => {
    let seen: { url?: string; auth?: string; body?: unknown } = {};
    handler = (req, body, res) => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      sendEvents(res, [delta({ content: 'ok' }), 'data: [DONE]\n\n']);
    };

    await collect(provider().streamChat(messages));

    expect(seen.url).toBe('/api/v1/chat/completions');
    expect(seen.auth).toBe('Bearer sk-test');
    expect(seen.body).toMatchObject({ model: DEFAULT_OPENROUTER_MODEL, messages, stream: true });
  });

  it('asks OpenRouter to skip the given upstream providers, and sends no routing otherwise', async () => {
    const bodies: unknown[] = [];
    handler = (_req, body, res) => {
      bodies.push(JSON.parse(body));
      sendEvents(res, [delta({ content: 'ok' }), 'data: [DONE]\n\n']);
    };

    await collect(
      new OpenRouterProvider({
        apiKey: 'sk-test',
        baseURL,
        ignoreProviders: ['sail-research'],
      }).streamChat(messages),
    );
    await collect(provider().streamChat(messages));

    expect(bodies[0]).toMatchObject({ provider: { ignore: ['sail-research'] } });
    expect(bodies[1]).not.toHaveProperty('provider');
  });

  it('streams only answer text, skipping comments, reasoning and usage chunks', async () => {
    handler = (_req, _body, res) =>
      sendEvents(res, [
        ': OPENROUTER PROCESSING\n\n',
        delta({ role: 'assistant', content: '', reasoning: 'Thinking...' }),
        delta({ content: 'Hello' }),
        delta({ content: ', world' }),
        delta({}, 'stop'),
        event({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }),
        'data: [DONE]\n\n',
      ]);

    const chunks: string[] = [];
    expect(await collect(provider().streamChat(messages), chunks)).toBe('Hello, world');
    expect(chunks).toEqual(['Hello', ', world']);
  });

  it('rejects with the upstream message on an HTTP error', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 401, message: 'No auth credentials found' } }));
    };

    await expect(collect(provider().streamChat(messages))).rejects.toThrow(
      /401.*No auth credentials found/,
    );
  });

  it('throws on an error sent mid-stream, after the partial reply', async () => {
    handler = (_req, _body, res) =>
      sendEvents(res, [
        delta({ content: 'partial' }),
        event({
          error: { code: 502, message: 'Provider disconnected' },
          choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
        }),
      ]);

    const chunks: string[] = [];
    await expect(collect(provider().streamChat(messages), chunks)).rejects.toThrow(
      'Provider disconnected',
    );
    expect(chunks).toEqual(['partial']);
  });

  describe('tools', () => {
    function lookupTool(run: ChatTool['run']): ChatTool {
      return {
        name: 'lookup',
        description: 'Look things up',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
        run,
      };
    }

    function toolCallEvents(calls: { id: string; name: string; args: string }[]): string[] {
      return [
        ...calls.map(({ id, name }, index) =>
          delta({
            tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }],
          }),
        ),
        // Arguments arrive in pieces after the call is announced.
        ...calls.flatMap(({ args }, index) => [
          delta({ tool_calls: [{ index, function: { arguments: args.slice(0, 4) } }] }),
          delta({ tool_calls: [{ index, function: { arguments: args.slice(4) } }] }),
        ]),
        delta({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ];
    }

    it('runs tool calls, sends the results back and streams the answer', async () => {
      const trace: TraceEvent[] = [];
      const bodies: any[] = [];
      handler = (_req, body, res) => {
        bodies.push(JSON.parse(body));
        sendEvents(
          res,
          bodies.length === 1
            ? toolCallEvents([{ id: 'call_1', name: 'lookup', args: '{"q":"refund"}' }])
            : [delta({ content: 'Refunds take 7 days.' }), 'data: [DONE]\n\n'],
        );
      };
      const args: unknown[] = [];
      const tool = lookupTool(async (a) => {
        args.push(a);
        return 'Refund: 7 days';
      });

      expect(
        await collect(
          provider().streamChat(messages, { tools: [tool], onTrace: (event) => trace.push(event) }),
        ),
      ).toBe('Refunds take 7 days.');
      expect(args).toEqual([{ q: 'refund' }]);
      expect(trace.map((event) => event.type)).toEqual([
        'model.start',
        'model.end',
        'tool.start',
        'tool.end',
        'model.start',
        'model.end',
      ]);
      expect(trace[2]).toMatchObject({
        callId: 'call_1',
        round: 0,
        content: { arguments: '{"q":"refund"}' },
      });
      expect(trace[3]).toMatchObject({ status: 'ok', content: { result: 'Refund: 7 days' } });
      expect(bodies[0].tools).toEqual([
        {
          type: 'function',
          function: { name: 'lookup', description: 'Look things up', parameters: tool.parameters },
        },
      ]);
      expect(bodies[1].messages).toEqual([
        ...messages,
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"refund"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'Refund: 7 days' },
      ]);
    });

    it('drops whitespace the model writes before the answer, e.g. alongside a tool call', async () => {
      let requests = 0;
      handler = (_req, _body, res) => {
        requests++;
        sendEvents(
          res,
          requests === 1
            ? [
                delta({ content: '\n\n' }),
                ...toolCallEvents([{ id: 'c', name: 'lookup', args: '{"q":"x"}' }]),
              ]
            : [delta({ content: ' \nHi' }), delta({ content: '\n\nthere' }), 'data: [DONE]\n\n'],
        );
      };

      const chunks: string[] = [];
      await collect(
        provider().streamChat(messages, { tools: [lookupTool(async () => 'r')] }),
        chunks,
      );
      expect(chunks).toEqual(['Hi', '\n\nthere']);
    });

    it('omits bank tool payloads and marks returned error strings as failures', async () => {
      let requests = 0;
      const trace: TraceEvent[] = [];
      handler = (_req, _body, res) =>
        sendEvents(
          res,
          requests++ === 0
            ? toolCallEvents([
                { id: 'bank', name: 'update_bank_info', args: '{"accountName":"PRIVATE"}' },
              ])
            : [delta({ content: 'Sorry' }), 'data: [DONE]\n\n'],
        );
      await collect(
        provider().streamChat(messages, {
          tools: [{ ...lookupTool(async () => 'Error: PRIVATE'), name: 'update_bank_info' }],
          onTrace: (event) => trace.push(event),
        }),
      );
      expect(trace.find((event) => event.type === 'tool.end')).toMatchObject({ status: 'error' });
      expect(JSON.stringify(trace)).not.toContain('PRIVATE');
    });

    it('reports failing and unknown tools to the model instead of failing', async () => {
      const trace: TraceEvent[] = [];
      const bodies: any[] = [];
      handler = (_req, body, res) => {
        bodies.push(JSON.parse(body));
        sendEvents(
          res,
          bodies.length === 1
            ? toolCallEvents([
                { id: 'call_1', name: 'lookup', args: '{"q":"x"}' },
                { id: 'call_2', name: 'missing', args: '{}' },
              ])
            : [delta({ content: 'Sorry.' }), 'data: [DONE]\n\n'],
        );
      };
      const tool = lookupTool(async () => {
        throw new Error('boom');
      });

      expect(
        await collect(
          provider().streamChat(messages, { tools: [tool], onTrace: (event) => trace.push(event) }),
        ),
      ).toBe('Sorry.');
      expect(
        trace.filter((event) => event.type === 'tool.end').map((event) => event.status),
      ).toEqual(['error', 'error']);
      expect(bodies[1].messages.slice(-2)).toEqual([
        { role: 'tool', tool_call_id: 'call_1', content: 'Error: boom' },
        { role: 'tool', tool_call_id: 'call_2', content: 'Error: unknown tool "missing"' },
      ]);
    });

    it('stops offering tools after 5 rounds so the model must answer', async () => {
      const bodies: any[] = [];
      handler = (_req, body, res) => {
        const request = JSON.parse(body);
        bodies.push(request);
        sendEvents(
          res,
          request.tools
            ? toolCallEvents([{ id: `call_${bodies.length}`, name: 'lookup', args: '{"q":"x"}' }])
            : [delta({ content: 'done' }), 'data: [DONE]\n\n'],
        );
      };
      const tool = lookupTool(async () => 'nothing');

      expect(await collect(provider().streamChat(messages, { tools: [tool] }))).toBe('done');
      expect(bodies).toHaveLength(6);
      expect(bodies[5]).not.toHaveProperty('tools');
    });
  });
});

describe('createOpenRouterEmbedder', () => {
  it('embeds texts with the default model, in input order', async () => {
    let seen: { url?: string; body?: unknown } = {};
    handler = (req, body, res) => {
      seen = { url: req.url, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          model: 'm',
          data: [
            { object: 'embedding', index: 1, embedding: [0, 1] },
            { object: 'embedding', index: 0, embedding: [1, 0] },
          ],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
      );
    };

    const embed = createOpenRouterEmbedder({ apiKey: 'sk-test', baseURL });

    expect(await embed(['a', 'b'])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(seen.url).toBe('/api/v1/embeddings');
    expect(seen.body).toEqual({
      model: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
      input: ['a', 'b'],
      encoding_format: 'float',
    });
  });
});
