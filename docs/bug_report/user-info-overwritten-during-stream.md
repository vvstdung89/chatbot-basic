# Bug: User Info edits lost when a `payment` event arrives

## Symptom

While a reply is streaming, the user edits a User Info box in Settings (e.g. User Profile). If
that reply saves bank info (`update_bank_info` → `payment` event), the User Profile edit is
reverted, on screen and in `localStorage`.

## Root cause

`apps/web/src/components/Chat.tsx`: `send` is created during one render and keeps running for the
whole stream. When the `payment` event arrives it calls the `updateUserInfo` from that same render,
which builds the new value from the `userInfo` captured then:

```ts
function updateUserInfo(key, value) {
  const next = { ...userInfo, [key]: value }; // userInfo from the render where send started
  setUserInfo(next);
  localStorage.setItem(USER_INFO_STORAGE_KEY, JSON.stringify(next));
}
```

Edits made after `send` started are not in that snapshot, so `next` drops them.

## Fix

- Test first: `apps/web/src/components/Chat.test.tsx` › "keeps User Info edits made while a reply
  streams when a payment event arrives" renders `Chat`, edits User Profile while the reply
  streams, then sends a `payment` event. It failed on the old code (User Profile was empty).
- `apps/web/src/components/useUserInfo.ts` (from the UI split) updates with
  `setUserInfo((current) => ({ ...current, [key]: value }))`, so a caller that started earlier
  merges into the latest value. Saving to `localStorage` moved to an effect on `userInfo` (after
  the first load), so the updater stays pure.
- The test passes; the other Chat tests cover sending, trimming and the QR flow.
