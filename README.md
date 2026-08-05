# TokenFlow

<!-- TODO: record and embed an asciinema GIF here (asciinema rec → agg to .gif).
     It belongs at the very top; a static demo is shown below until then. -->

[![CI](https://github.com/vinayparit007-png/tokenflow/actions/workflows/ci.yml/badge.svg)](https://github.com/vinayparit007-png/tokenflow/actions/workflows/ci.yml)

**A terminal LLM client that tells you what you actually spent.** If you're paying
per token across Anthropic, OpenAI, and Gemini, TokenFlow tracks the cost live and
accurately, in one place.

```console
$ git diff | tokenflow "write a commit message"
feat(auth): rotate refresh tokens on every use

Prevents replay of a leaked refresh token…
claude-opus-4-8 · 412 in / 96 out · $0.00234 · 1.2s · ttft 380ms

$ tokenflow -m claude,gpt,gemini "explain CRDTs in one line"
■ claude-opus-4-8   …
■ gpt-4o            …
■ gemini-2.5-pro    …

MODEL              IN   OUT      COST  LATENCY   TTFT
───────────────  ────  ────  ────────  ───────  ─────
claude-opus-4-8   210    88   $0.0021    1180ms  360ms
gpt-4o            210    72   $0.0014     900ms  310ms
gemini-2.5-pro    210    91   $0.0008     820ms  300ms
total: $0.0043
```

## Install

```bash
npx @vinayparit005/tokenflow "hello"
```

Or install it (the command is still just `tokenflow` afterward):

```bash
npm install -g @vinayparit005/tokenflow
```

Requires **Node 22.5+** (for the built-in `node:sqlite`). Set at least one key:

```bash
export ANTHROPIC_API_KEY=…   # and/or OPENAI_API_KEY, GEMINI_API_KEY
```

## Usage

```bash
tokenflow "prompt"                     # one-shot
tokenflow                              # interactive REPL
git diff | tokenflow "summarise this"  # pipe stdin as context
tokenflow -m claude,gpt,gemini "…"     # fan out to several models
tokenflow --json "…" | jq .cost_usd    # machine-readable output
tokenflow log                          # list past sessions
tokenflow log search "commit message"  # full-text search history
tokenflow cost --since 7d              # spend grouped by model and day
tokenflow --continue "and then?"       # resume the last session
```

| Flag | Meaning |
| --- | --- |
| `-m, --model <a,b,…>` | model or alias (`fast`, `cheap`, `smart`); comma = fan-out |
| `-s, --system <text>` | system prompt |
| `--max-tokens <n>` | cap output tokens |
| `--no-stream` | print the full response at once |
| `--json` | emit a JSON object (text, usage, cost) |
| `--continue` | resume the last session |
| `--color` / `--no-color` | force color on/off |

Exit codes: `0` ok, `2` usage error, `3` provider/API error, `4` cancelled, `5` bad config.

## Configuration

Optional `~/.tokenflow/config.json`. **API keys are never stored here** — only the
name of the env var that holds each key:

```json
{
  "defaultModel": "claude-opus-4-8",
  "aliases": { "fast": "claude-haiku-4-5", "smart": "claude-opus-4-8" },
  "providers": {
    "anthropic": { "keyEnv": "ANTHROPIC_API_KEY" },
    "openai": { "keyEnv": "WORK_OPENAI_KEY", "baseUrl": "https://gateway.internal" }
  }
}
```

Pricing lives in a versioned [`pricing.json`](src/pricing/pricing.json) with a
`updated` date and a `source` URL per provider, so you can patch a rate change
without waiting for a release. Rates are integer **nanodollars per token**.

### Other AI labs

TokenFlow isn't limited to the three built-in providers. Most labs that have
shipped since — DeepSeek, Mistral, Groq, Together, Fireworks, Perplexity,
xAI/Grok, OpenRouter, Azure OpenAI, and local servers (Ollama, LM Studio,
vLLM) — speak the same OpenAI-compatible `/chat/completions` streaming format.
Add one under `customProviders`: a name you choose, a base URL, and (optionally)
which env var holds the key:

```json
{
  "customProviders": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com",
      "keyEnv": "DEEPSEEK_API_KEY",
      "models": {
        "deepseek-chat": { "input": 270, "output": 1100, "cacheWrite": 0, "cacheRead": 70 }
      }
    },
    "local-llama": {
      "baseUrl": "http://localhost:11434",
      "keyEnv": "OLLAMA_API_KEY"
    }
  }
}
```

Then pick any of its models with `label:model` addressing:

```bash
tokenflow -m deepseek:deepseek-chat "explain CRDTs in one line"
tokenflow -m claude,gpt-4o,deepseek:deepseek-chat "compare these"   # mix built-in and custom in one fan-out
```

If a bare model name (no `label:`) is unambiguous — only one configured
provider declares it — you can drop the prefix: `-m deepseek-chat` works too.
`keyEnv` defaults to `<LABEL>_API_KEY` if you omit it (`deepseek` →
`DEEPSEEK_API_KEY`). The `models` rates are optional — an unrated model still
runs, its cost just shows `?` (decision 3), never a wrong `$0.00`.

This works because `createOpenAICompatibleProvider` (in
[`src/providers/custom.ts`](src/providers/custom.ts)) reuses the exact same
request builder, SSE parser, and usage adapter as the built-in OpenAI client —
only the name, URL, and key differ. A lab with a genuinely different wire
format (not OpenAI-shaped) needs a real adapter, the way Anthropic and Gemini
have one — a small, contained addition, not a rewrite, but still code.

## Design decisions

These are the load-bearing choices. They exist because getting cost tracking
*right* across providers is harder than it looks.

1. **Adapters emit absolute totals, never increments.** Each provider adapter is a
   pure `(usage, event) => usage` reducer that assigns fields. Anthropic's
   `message_delta` usage is a cumulative running total and cache counts appear in
   more than one event, so `usage.output += …` double-counts (the bug that shipped
   in LangChain's 2× cache tokens and Cline's context drift). Replaying a stream
   with every event duplicated yields identical totals.
   *Implementation note:* we merge by the **per-field max** of the absolute totals
   rather than literal last-write. Both avoid `+=`, but max is also order-invariant
   — needed because `message_start` reports `output_tokens: 1` while the later
   delta reports the real total, so last-write-wins would be reorder-sensitive.
2. **Money is integer nanodollars (`bigint`), formatted only at the edge.** Rates
   are fractions of a cent per token; float accumulation drifts visibly over a long
   session. All arithmetic is exact `bigint`; a decimal string is produced only in
   the formatter.
3. **Unknown pricing yields `null`, and null propagates.** A model missing from
   the pricing table costs `null`, not `0`. Any unpriced turn makes the session
   total `?` with a note naming the model. Never a confidently-wrong `$0.00`.
4. **Pricing is a versioned data file, not source.** Patch a rate in
   `pricing.json` and go; no release required.
5. **Cache tokens are normalised to be disjoint from input.** OpenAI and Gemini
   report cached tokens *inside* the prompt count; Anthropic reports them *beside*
   it. After adaptation `input` and `cacheRead` never overlap — asserted in the
   contract suite — so the same token is never billed at two rates.
6. **One TTY chokepoint governs all formatting.** `process.stdout.isTTY === false`
   means piped: raw text, no ANSI, no spinner, no markdown, and the cost line goes
   to **stderr** so `tokenflow "…" | jq` sees only the model's output. This lives
   in one place ([`src/cli/tty.ts`](src/cli/tty.ts)), not scattered conditionals.

### What the tests prove — and what they don't

The offline suite (120 tests) pins exact totals against recorded event streams,
proves idempotence and order-invariance with property tests, and enforces the
`Usage` contract identically across all three providers.

**Frozen fixtures cannot catch a provider changing its wire format.** If OpenAI
renames `prompt_tokens` tomorrow, every fixture keeps passing while real calls
break. The mitigation is an optional **shape-only live test**
([`test/live/shape.live.test.ts`](test/live/shape.live.test.ts)) that hits the
real APIs and asserts the usage *shape* (not counts) still holds. It is gated
behind `TOKENFLOW_LIVE=1` plus keys, self-skips in the normal suite, and
[runs nightly in CI](.github/workflows/nightly-live.yml) with secrets.

### Substitutions from the original brief

- **`node:sqlite` instead of `better-sqlite3`.** Node 22.5+ ships a synchronous
  SQLite with FTS5 built in — the same API the brief wanted, with no native
  compilation to fail on new Node versions. It's isolated in
  [`src/history/store.ts`](src/history/store.ts) if you want to swap it back.

## Development

```bash
npm install
npm test          # offline suite
npm run typecheck
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
