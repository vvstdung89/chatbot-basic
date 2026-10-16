# Bug: bank updates fail when OpenRouter routes to Sail Research

## Symptom

Found in the option B live run. "Cập nhật tài khoản của anh sang Vietcombank 0123456789" sometimes
ends in a 502 after ~14 s: `update_bank_info` returns an error in all 5 tool rounds, then the last
round fails with "Upstream error from Sail Research: no capacity available for this model right
now". Other times the same message works.

## Root cause

OpenRouter spreads `deepseek/deepseek-v4.1-flash` over ~35 upstream providers. The failing requests
all went to **Sail Research** (tool call ids `call_resp_…`). Asking that provider directly with the
same tool (OpenRouter `provider.only`), twice:

| Provider                                                     | Tool call arguments                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Sail Research                                                | `{"step":"propose"}`: optional parameters (`bank`, `accountNumber`) are left out |
| Sail Research, with `bank` / `accountNumber` marked required | all filled, but it also invents `accountName: "Chủ tài khoản"`                   |
| Novita, Together                                             | `{"step":"propose","bank":"Vietcombank","accountNumber":"0123456789"}`           |

So `propose` correctly answers "unknown bank" every time, the model repeats the same empty call
until the round limit, and the provider then runs out of capacity. Our code behaves correctly; the
upstream provider does not pass optional tool arguments. Making every parameter required is not a
fix: the provider then makes up values (a fake holder name would be read back and could be saved).

## Fix

- Tests first: `openrouter.test.ts` (the request carries OpenRouter's `provider.ignore` when
  providers are given, nothing otherwise) and `providers.test.ts` (`OPENROUTER_IGNORE_PROVIDERS`
  parsing, default, empty = none).
- `OpenRouterProvider` takes `ignoreProviders` and sends `provider: { ignore: [...] }`.
  `getProvider` reads `OPENROUTER_IGNORE_PROVIDERS` (comma-separated slugs), default
  `DEFAULT_IGNORED_PROVIDERS` = `sail-research`; documented in `.env.example` and the README.
- Live rerun of all option B scenarios on the dev server afterwards: all five behave as specified
  (`docs/feature/bank-info-confirm/progress.md`).
- Watch for: OpenRouter's provider list changes over time. If tool calls start failing again with
  `call_resp_…`-style ids or empty arguments, check which provider served them and add its slug.
