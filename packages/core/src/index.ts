export type {
  ChatEvent,
  ChatMessage,
  ChatOptions,
  ChatProvider,
  ChatRole,
  ChatTool,
  Embedder,
} from './types';
export { runChat, type ChatRequest, type RunChatOptions } from './chat/run-chat';
export { createTrace, emitTrace, type TraceEvent, type TraceCallback } from './chat/trace';
export { encodeChatEvent, readChatEvents } from './chat/events';
export {
  ChatRequestError,
  MAX_HISTORY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  parseChatTurn,
  parseSessionId,
  parseUserInfo,
  trimHistory,
  type ChatTurnRequest,
} from './chat/validate';
export {
  MemorySessionStore,
  type MemorySessionStoreOptions,
  type Session,
  type SessionStore,
} from './session/store';
export { chatTurn, SessionBusyError, type ChatTurnOptions } from './session/chat-turn';
export {
  MAX_USER_INFO_LENGTH,
  USER_INFO_SECTIONS,
  type UserInfo,
  type UserInfoKey,
} from './chat/user-info';
export {
  buildSystemPrompt,
  SUMMARY_PROMPT,
  SYSTEM_PROMPT,
  withSystemPrompt,
  type PromptContext,
} from './chat/prompt';
export {
  findBank,
  formatPaymentInfo,
  normalizeAccountName,
  parseVietQR,
  paymentReadBack,
  paymentReadFailed,
  PaymentQrError,
  QR_UPLOAD_MESSAGE,
  type Bank,
  type PaymentQrInfo,
} from './payment/vietqr';
export { updateBankInfoTool, type UpdateBankInfoToolOptions } from './payment/bank-tool';
// QR image decoding (sharp, server only) is imported from '@chatbot/core/qr-image'.
export {
  createSummarizer,
  estimateTokens,
  fitHistory,
  HISTORY_TOKEN_BUDGET,
  type FitHistoryOptions,
  type HistorySummary,
} from './chat/context';
export {
  chunkDocument,
  KnowledgeBase,
  searchDocumentsTool,
  type DocumentChunk,
  type KnowledgeBaseOptions,
  type SearchResult,
} from './rag/knowledge';
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
