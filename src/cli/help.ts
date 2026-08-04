/** Help and version text, kept out of the dispatcher for readability. */

export const HELP_TEXT = `tokenflow — a terminal LLM client with accurate, live cost tracking

USAGE
  tokenflow "prompt"                 one-shot completion
  tokenflow                          interactive REPL (in a TTY)
  git diff | tokenflow "summarise"   pipe stdin as context
  tokenflow log [search <query>]     browse history
  tokenflow cost [--since 7d]        spend report

OPTIONS
  -m, --model <name[,name...]>  model, alias, or "label:model"; comma = fan-out
  -s, --system <text>          system prompt
      --max-tokens <n>         cap output tokens
      --no-stream              print the full response at once
      --json                   emit a JSON object (text, usage, cost)
      --continue               resume the last session
      --theme <name>           color theme: neon (default), aurora, sunset, matrix
      --color / --no-color     force color on/off
  -h, --help                   show this help
  -v, --version                show version

Costs print to stdout in a TTY, to stderr when piped, so \`tokenflow "..." | jq\`
sees only the model's output. Built-in models: claude-*, gpt-*, gemini-* (or the
fast/cheap/smart aliases), via ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY.

OTHER AI LABS
Add any OpenAI-compatible lab (DeepSeek, Mistral, Groq, OpenRouter, a local
Ollama server, ...) under "customProviders" in ~/.tokenflow/config.json — a
name, a baseUrl, and a keyEnv. Then address its models as "label:model", e.g.
\`tokenflow -m deepseek:deepseek-chat "..."\`. See the README for a full example.
`;
