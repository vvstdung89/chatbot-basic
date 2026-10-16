export type { ChatMessage, ChatOptions, ChatProvider, ChatRole, ChatTool, Embedder } from './types';
export { ChatRequestError, parseMessages, parseUserInfo } from './validate';
export {
  MAX_USER_INFO_LENGTH,
  USER_INFO_SECTIONS,
  type UserInfo,
  type UserInfoKey,
} from './user-info';
export {
  buildSystemPrompt,
  SUMMARY_PROMPT,
  SYSTEM_PROMPT,
  withSummary,
  withSystemPrompt,
} from './prompt';
export {
  createSummarizer,
  estimateTokens,
  fitHistory,
  HISTORY_TOKEN_BUDGET,
  type FitHistoryOptions,
  type HistorySummary,
} from './context';
export {
  chunkDocument,
  KnowledgeBase,
  searchDocumentsTool,
  type DocumentChunk,
  type KnowledgeBaseOptions,
  type SearchResult,
} from './knowledge';
export {
  createOpenRouterEmbedder,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_PROVIDER,
  EchoProvider,
  getEmbedder,
  getProvider,
  OpenRouterProvider,
  providerNames,
  type EchoProviderOptions,
  type Env,
  type OpenRouterEmbedderOptions,
  type OpenRouterProviderOptions,
} from './providers';
