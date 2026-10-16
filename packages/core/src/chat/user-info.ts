// No Node imports here: the web UI imports this file via `@chatbot/core/user-info`.

/** The parts of the User Info setting, in prompt order. Add a part here to get a new text box. */
export const USER_INFO_SECTIONS = [
  { key: 'profile', label: 'User Profile' },
  { key: 'payment', label: 'User Payment' },
  { key: 'purchaseHistory', label: 'User Purchase History' },
  { key: 'commission', label: 'User Commission' },
  { key: 'paymentHistory', label: 'Payment History' },
] as const;

export type UserInfoKey = (typeof USER_INFO_SECTIONS)[number]['key'];

export type UserInfo = Partial<Record<UserInfoKey, string>>;

/** Max characters per section. */
export const MAX_USER_INFO_LENGTH = 10_000;
