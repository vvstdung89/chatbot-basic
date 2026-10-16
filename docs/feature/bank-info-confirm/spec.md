# Spec: confirm before saving bank info (option B)

## Goal

Bank info (User Payment) is never saved in the turn the details first appear. Typed details and QR
details both become **pending details** first; the user confirms in a later message. Built on
server-side sessions (`docs/feature/server-sessions/`): pending details live in the session, the
browser does nothing for this flow.

Replaces the `source: "qr" | "text"` behaviour of `docs/feature/bank-info-tool/`, where typed
details were saved immediately.

## Tool

`update_bank_info({ step, bank?, accountNumber?, accountName? })`, still one tool:

| `step`    | Does                                                                                                                                                                       | Saves? |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `propose` | Validates typed details (`findBank`, account number, name normalized) and makes them the session's pending details. Returns "Not saved yet" + the details to show the user | No     |
| `confirm` | Saves the details that were pending **when the request arrived** (bank and number exactly as read back; `accountName` may be added). Clears them                           | Yes    |
| `cancel`  | Discards the pending details                                                                                                                                               | No     |

- QR upload already creates pending details (`/api/payment-qr`); its confirmation uses `confirm`.
- `confirm` without pending details → `Error: …`, nothing saved.
- After `propose` or `cancel` in a turn, `confirm` in the same turn → `Error: …` ("wait for the
  user's reply"): proposing and confirming in one turn is impossible.
- Bad bank / number on `propose` → `Error: …`, pending details unchanged.
- The tool description and the system prompt section (Pending Bank Details) tell the model: never
  save without the user's confirmation; show the returned details exactly; confirm → `confirm`,
  decline → `cancel`, anything else → answer and ask again.

## Events

`runChat` emits `pending_payment` (`{ pending: PaymentQrInfo | null }`) on propose / cancel and
`payment` on confirm. The session layer applies both to the session; the browser only receives
`payment` (to refresh the Settings panel).

## Out of scope

Editing pending details in place (the user proposes again instead), confirm buttons in the UI.
