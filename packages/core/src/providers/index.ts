import type { ChatProvider, Embedder } from '../types';
import { EchoProvider } from './echo';
import { createOpenRouterEmbedder, OpenRouterProvider } from './openrouter';

export type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_PROVIDER = 'openrouter';

/**
 * Registered providers, keyed by the name used in CHAT_PROVIDER.
 * To add one: implement ChatProvider in this folder and register it here.
 */
const providers = new Map<string, (env: Env) => ChatProvider>([
  [
    'openrouter',
    (env) =>
      new OpenRouterProvider({
        apiKey: requireEnv(env, 'OPENROUTER_API_KEY'),
        model: env.OPENROUTER_MODEL,
      }),
  ],
  ['echo', () => new EchoProvider()],
]);

export const providerNames: readonly string[] = [...providers.keys()];

/** Creates the provider named by CHAT_PROVIDER, configured from `env`. */
export function getProvider(env: Env): ChatProvider {
  const name = env.CHAT_PROVIDER || DEFAULT_PROVIDER;
  const create = providers.get(name);
  if (!create) {
    throw new Error(`Unknown chat provider "${name}". Available: ${providerNames.join(', ')}`);
  }
  return create(env);
}

/** Creates the embedder used for document search (OpenRouter, so it needs OPENROUTER_API_KEY). */
export function getEmbedder(env: Env): Embedder {
  return createOpenRouterEmbedder({
    apiKey: requireEnv(env, 'OPENROUTER_API_KEY'),
    model: env.OPENROUTER_EMBEDDING_MODEL,
  });
}

function requireEnv(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

export { EchoProvider, type EchoProviderOptions } from './echo';
export {
  createOpenRouterEmbedder,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterProvider,
  type OpenRouterEmbedderOptions,
  type OpenRouterProviderOptions,
} from './openrouter';
