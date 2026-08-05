# TokenFlow

[![CI](https://github.com/vinayparit007-png/tokenflow/actions/workflows/ci.yml/badge.svg)](https://github.com/vinayparit007-png/tokenflow/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@vinayparit005/tokenflow.svg)](https://www.npmjs.com/package/@vinayparit005/tokenflow)
[![node](https://img.shields.io/node/v/@vinayparit005/tokenflow.svg)](package.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Accurate, real-time cost tracking for LLM conversations — directly in your terminal.**

TokenFlow is a multi-provider terminal client that reports the exact cost of every request and session across Anthropic, OpenAI, Google Gemini, and any OpenAI-compatible provider. No more guessing what your API usage costs.

```
$ git diff | tokenflow "write a commit message"
feat(auth): rotate refresh tokens on every use

Prevents replay of a leaked refresh token…
claude-opus-4-8 · 412 in / 96 out · $0.00234 · 1.2s · ttft 380ms
```

```
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

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Adding Custom Providers](#adding-custom-providers)
- [Architecture & Design](#architecture--design)
- [Development](#development)
- [License](#license)

## Installation

Try it immediately with `npx`:

```bash
npx @vinayparit005/tokenflow "hello"
```

For persistent use, install globally:

```bash
npm install -g @vinayparit005/tokenflow
```

**Requirements:** Node.js 22.5+ (uses the built-in `node:sqlite` module).

Set at least one provider API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
export OPENAI_API_KEY=sk-…
export GEMINI_API_KEY=…
```

## Quick Start

```bash
tokenflow "prompt"                     # Single completion
tokenflow                              # Interactive REPL
git diff | tokenflow "summarise this"  # Pipe context via stdin
tokenflow -m claude,gpt,gemini "…"     # Fan-out across multiple models
tokenflow --json "…" | jq .cost_usd    # Machine-readable JSON output
tokenflow log                          # Browse session history
tokenflow log search "commit message"  # Full-text search across history
tokenflow cost --since 7d              # Spending report by model and day
tokenflow --continue "and then?"       # Resume a previous session
```

### Options

| Flag | Description |
| --- | --- |
| `-m, --model <a,b,…>` | Model name, alias (`fast`, `cheap`, `smart`), or `label:model`. Comma-separated values fan out to multiple models in parallel. |
| `-s, --system <text>` | System prompt prepended to each request. |
| `--max-tokens <n>` | Maximum number of generated tokens. |
| `--no-stream` | Wait for the complete response instead of streaming. |
| `--json` | Output a single JSON object containing text, usage, and cost. |
| `--continue` | Resume the most recent session with full context. |
| `--theme <name>` | Terminal color theme: `neon` (default), `aurora`, `sunset`, `matrix`. |
| `--color` / `--no-color` | Force color output on or off, overriding TTY detection. |
| `-h, --help` | Display help. |
| `-v, --version` | Display version. |

### Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Invalid usage / bad arguments |
| `3` | Provider or API error |
| `4` | Cancelled by user |
| `5` | Invalid configuration |

## Configuration

TokenFlow reads `~/.tokenflow/config.json` on startup. API keys are **never** stored in this file — only the name of the environment variable that holds each key:

```json
{
  "defaultModel": "claude-opus-4-8",
  "aliases": {
    "fast": "claude-haiku-4-5",
    "smart": "claude-opus-4-8"
  },
  "providers": {
    "anthropic": { "keyEnv": "ANTHROPIC_API_KEY" },
    "openai": { "keyEnv": "WORK_OPENAI_KEY", "baseUrl": "https://gateway.internal" }
  }
}
```

### Pricing

Model pricing is maintained in a versioned data file ([`pricing.json`](src/pricing/pricing.json)) with an `updated` timestamp and `source` URL per provider. Rates are stored as integer **nanodollars per token**, ensuring exact arithmetic with no floating-point drift. A pricing change can be patched directly without waiting for a new release.

## Adding Custom Providers

TokenFlow supports any OpenAI-compatible provider out of the box — DeepSeek, Mistral, Groq, Together, Fireworks, Perplexity, xAI/Grok, OpenRouter, Azure OpenAI, and local servers like Ollama, LM Studio, or vLLM.

Add a provider under `customProviders` with a name, base URL, and (optionally) the environment variable for its API key:

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

Address models with `label:model` syntax, and mix built-in and custom providers freely in a single fan-out:

```bash
tokenflow -m deepseek:deepseek-chat "explain CRDTs in one line"
tokenflow -m claude,gpt-4o,deepseek:deepseek-chat "compare these"
```

When a bare model name is unambiguous — only one configured provider declares it — the `label:` prefix can be omitted. `keyEnv` defaults to `<LABEL>_API_KEY` when not specified (e.g., `deepseek` derives `DEEPSEEK_API_KEY`).

Listing model rates under `models` is optional. An unrated model still works; its cost displays as `?` rather than a misleading `$0.00`.

> **Note:** This works because [`createOpenAICompatibleProvider`](src/providers/custom.ts) reuses the same request builder, SSE parser, and usage adapter as the built-in OpenAI client. A provider with a genuinely different wire format (non-OpenAI-shaped) requires a dedicated adapter — a contained addition, not a rewrite.

## Architecture & Design

Accurate multi-provider cost tracking is harder than it looks. These design decisions make it correct.

### 1. Absolute totals, never increments

Each provider adapter is a pure `(usage, event) => usage` reducer that **assigns** fields rather than accumulating them. Anthropic's `message_delta` usage is a cumulative running total, and cache counts appear in multiple events — `usage.output += …` would double-count tokens. This is the class of bug behind LangChain's 2x cache-token overcount and similar drift issues in other tools.

Fields are merged via the **per-field maximum** of absolute totals, making the merge both idempotent and order-invariant. Replaying a stream with every event duplicated yields identical results.

### 2. Integer nanodollar arithmetic

All monetary values use `bigint` nanodollars (10⁻⁹ USD). Provider rates are fractions of a cent per token; floating-point accumulation drifts visibly over long sessions. Decimal strings are produced only at the display boundary by the formatter.

### 3. Null propagation for unknown pricing

A model missing from the pricing table costs `null`, not `0`. Any turn with unknown pricing causes the session total to display as `?` with a note naming the model — never a confidently wrong `$0.00`.

### 4. Disjoint cache token normalization

OpenAI and Gemini report cached tokens *inside* the prompt count; Anthropic reports them *alongside* it. After normalization, `input` and `cacheRead` never overlap — enforced by the contract test suite — so no token is billed at two rates.

### 5. Single TTY chokepoint

All output formatting decisions flow through a single point ([`src/cli/tty.ts`](src/cli/tty.ts)). When stdout is piped (`!process.stdout.isTTY`): plain text only, no ANSI codes, no spinner, no markdown rendering, and cost is written to **stderr** so that `tokenflow "…" | jq` receives only the model's output on stdout.

### Testing Strategy

The offline suite (120+ tests) pins exact totals against recorded event streams, proves idempotence and order-invariance via property-based tests (fast-check), and enforces the `Usage` contract identically across all three built-in providers.

Frozen fixtures cannot detect a provider changing its wire format. This is mitigated by an optional **shape-only live test** ([`test/live/shape.live.test.ts`](test/live/shape.live.test.ts)) that calls real APIs and asserts the usage *shape* still holds — gated behind `TOKENFLOW_LIVE=1` and valid keys, skipped in the standard suite, and [run nightly in CI](.github/workflows/nightly-live.yml).

### Implementation Notes

- **`node:sqlite` over `better-sqlite3`:** Node 22.5+ ships a synchronous SQLite implementation with FTS5, eliminating the native module compilation step. Isolated in [`src/history/store.ts`](src/history/store.ts) should a different driver be preferred.

## Development

```bash
npm install           # Install dependencies
npm test              # Run the offline test suite (120+ tests)
npm run typecheck     # TypeScript type checking
npm run build         # Compile to dist/
```

## License

[MIT](LICENSE)
