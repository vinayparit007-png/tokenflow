/** Help and version text, kept out of the dispatcher for readability. */

export const HELP_TEXT = `tokenflow — a terminal LLM client with accurate, live cost tracking

USAGE
  tokenflow "prompt"                 one-shot completion
  tokenflow                          interactive REPL (in a TTY)
  git diff | tokenflow "summarise"   pipe stdin as context
  tokenflow log [search <query>]     browse history
  tokenflow cost [--since 7d]        spend report

OPTIONS
  -m, --model <name[,name...]>  model or alias (fast, cheap, smart); comma = fan-out
  -s, --system <text>          system prompt
      --max-tokens <n>         cap output tokens
      --no-stream              print the full response at once
      --json                   emit a JSON object (text, usage, cost)
      --continue               resume the last session
      --color / --no-color     force color on/off
  -h, --help                   show this help
  -v, --version                show version

Costs print to stdout in a TTY, to stderr when piped, so \`tokenflow "..." | jq\`
sees only the model's output. Set provider keys via env vars (ANTHROPIC_API_KEY,
OPENAI_API_KEY, GEMINI_API_KEY) or reference custom names in ~/.tokenflow/config.json.
`;
