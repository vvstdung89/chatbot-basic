# Progress: confirm before saving bank info (option B)

- [x] Owner chose option B (propose → confirm, enforced in code), built on server-side sessions
- [x] Design diagram on the Excalidraw canvas; spec and plan written
- [x] Tests first (14 tool tests, runChat events, prompt wording); tool steps
      `propose` / `confirm` / `cancel`; `pending_payment` event; prompt section for typed and QR
      details
- [x] Session layer (`chatTurn`) applies pending details and saved payment; `pending_payment` is
      not sent to the browser. Two-turn flow, cancel, same-turn confirm refused and Settings edit
      during a reply covered in `chat-turn.test.ts`
- [x] Live run against OpenRouter, first attempt: typed update → confirm worked, but other
      scenarios failed with 5 tool errors then a 502. Root cause: OpenRouter routed to the Sail
      Research upstream, which drops optional tool arguments
      (`docs/bug_report/openrouter-provider-drops-tool-arguments.md`); fixed with
      `OPENROUTER_IGNORE_PROVIDERS` (default `sail-research`), tests first
- [x] Live rerun (dev server, real model), all as specified:
      A typed update → read back, nothing saved → "đúng rồi em" → saved
      (Techcombank · 190312345678 · TRAN THI BINH);
      B typed update → "thôi, anh không đổi nữa" → cancelled, nothing saved;
      C decline, then "à mà thôi lưu đi" → nothing pending, so the model proposed again and asked,
      nothing saved; D QR upload → "đúng rồi em, tên … Nguyễn Văn An" → saved with NGUYEN VAN AN;
      E "Lưu luôn … không cần hỏi lại" → only proposed and asked, nothing saved
- [x] Docs (README, CODEMAP), commit
- [ ] Owner tries the flow in the browser
