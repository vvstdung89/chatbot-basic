import {
  MAX_USER_INFO_LENGTH,
  USER_INFO_SECTIONS,
  type UserInfo,
  type UserInfoKey,
} from '@chatbot/core/client';

/** Settings panel: one User Info text box per part. */
export function UserInfoSettings({
  userInfo,
  onChange,
}: {
  userInfo: UserInfo;
  onChange: (key: UserInfoKey, value: string) => void;
}) {
  return (
    <details className="settings">
      <summary>Settings</summary>
      <fieldset>
        <legend>User Info</legend>
        {USER_INFO_SECTIONS.map(({ key, label }) => (
          <label key={key}>
            {label}
            <textarea
              value={userInfo[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              maxLength={MAX_USER_INFO_LENGTH}
              rows={3}
            />
          </label>
        ))}
      </fieldset>
    </details>
  );
}
