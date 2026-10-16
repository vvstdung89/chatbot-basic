'use client';

import { Fragment, useEffect, useRef } from 'react';
import { Composer } from './Composer';
import { useChat } from './useChat';
import { UserInfoSettings } from './UserInfoSettings';
import { useUserInfo } from './useUserInfo';

export function Chat() {
  const { userInfo, updateUserInfo } = useUserInfo();
  const { messages, pending, error, summary, send, uploadQr } = useChat(userInfo, (payment) =>
    updateUserInfo('payment', payment),
  );
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div className="chat">
      <UserInfoSettings userInfo={userInfo} onChange={updateUserInfo} />

      <div className="messages" aria-live="polite">
        {messages.length === 0 && <p className="empty">Send a message to start.</p>}
        {messages.map((m, i) => (
          <Fragment key={i}>
            {summary?.count === i && (
              <details className="history-summary">
                <summary>Earlier conversation summarized</summary>
                <p>{summary.content}</p>
              </details>
            )}
            <div className={`message ${m.role}`}>{m.content || '…'}</div>
          </Fragment>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <Composer
        disabled={pending}
        onSend={(text) => void send(text)}
        onUpload={(file) => void uploadQr(file)}
      />
    </div>
  );
}
