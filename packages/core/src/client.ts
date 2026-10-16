// Browser entry (`@chatbot/core/client`): only code without Node, openai, sharp or jsqr imports.
// client.test.ts fails if anything reachable from here imports them.
export type { ChatEvent, ChatMessage, ChatRole } from './types';
export type { HistorySummary } from './chat/context';
export { readChatEvents } from './chat/events';
export { MAX_MESSAGE_LENGTH } from './chat/validate';
export {
  MAX_USER_INFO_LENGTH,
  USER_INFO_SECTIONS,
  type UserInfo,
  type UserInfoKey,
} from './chat/user-info';
export { QR_UPLOAD_MESSAGE } from './payment/vietqr';
