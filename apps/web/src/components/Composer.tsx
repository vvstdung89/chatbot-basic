import { useRef, useState, type FormEvent } from 'react';
import { MAX_MESSAGE_LENGTH } from '@chatbot/core/client';

/** Message input with Send, and the QR button that uploads a bank QR image. */
export function Composer({
  disabled,
  onSend,
  onUpload,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
}) {
  const [input, setInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || disabled) return;
    setInput('');
    onSend(text);
  }

  return (
    <form className="composer" onSubmit={submit}>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // allow picking the same file again
          if (file) onUpload(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        aria-label="Upload bank QR image"
      >
        QR
      </button>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a message…"
        aria-label="Message"
        maxLength={MAX_MESSAGE_LENGTH}
        autoFocus
      />
      <button type="submit" disabled={disabled || !input.trim()}>
        Send
      </button>
    </form>
  );
}
