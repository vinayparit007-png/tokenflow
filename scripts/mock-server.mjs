// A local fake provider server for trying TokenFlow WITHOUT real API keys or cost.
// It speaks the Anthropic/OpenAI/Gemini SSE shapes on one port.
//
//   node scripts/mock-server.mjs           # starts on http://127.0.0.1:8788
//
// Point TokenFlow at it via ~/.tokenflow/config.json baseUrl overrides (the
// scripts/try-mock.sh helper does this for you in a temp home dir).
import { createServer } from "node:http";

const anthropic = [
  { type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 } } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "Hello from the mock Claude." } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "\n\n```js\nconst x = 1;\n```\n" } },
  { type: "message_delta", usage: { output_tokens: 300 } },
  { type: "message_stop" },
];
const openai = [
  { choices: [{ delta: { content: "Hello from the mock GPT." } }], usage: null },
  { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 80 } } },
];
const gemini = [
  { candidates: [{ content: { parts: [{ text: "Hello from the mock Gemini." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, cachedContentTokenCount: 200, thoughtsTokenCount: 80 } },
];

const PORT = Number(process.env.MOCK_PORT ?? 8788);
createServer((req, res) => {
  let events;
  let done = false;
  if (req.url.includes("messages")) events = anthropic;
  else if (req.url.includes("chat/completions")) { events = openai; done = true; }
  else events = gemini;
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (done) res.write("data: [DONE]\n\n");
  res.end();
}).listen(PORT, () => console.log(`mock provider up on http://127.0.0.1:${PORT}`));
