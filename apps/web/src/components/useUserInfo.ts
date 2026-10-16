import { useCallback, useEffect, useState } from 'react';
import type { UserInfo, UserInfoKey } from '@chatbot/core/client';

const STORAGE_KEY = 'chatbot.userInfo';

/** User Info, saved in localStorage. */
export function useUserInfo() {
  const [userInfo, setUserInfo] = useState<UserInfo>({});
  const [loaded, setLoaded] = useState(false);

  // Loaded after mount so the server render and first client render match.
  useEffect(() => {
    try {
      setUserInfo(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {});
    } catch {
      // Missing or unreadable storage: start empty.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userInfo));
    } catch {
      // Storage unavailable: the setting still applies until reload.
    }
  }, [userInfo, loaded]);

  // Updates the latest value, so a caller that started earlier (e.g. a streaming reply that
  // saves bank info) never overwrites edits made since.
  const updateUserInfo = useCallback((key: UserInfoKey, value: string) => {
    setUserInfo((current) => ({ ...current, [key]: value }));
  }, []);

  return { userInfo, updateUserInfo };
}
