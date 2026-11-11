// Creates (or updates) the Interviewer and Tutor agents on ElevenLabs from the
// prompts in docs/agents.md, then writes their IDs into .env.local.
// Usage: npm run agents
import { readFileSync, writeFileSync } from "node:fs";

const ENV = ".env.local";
const env = Object.fromEntries(
  readFileSync(ENV, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const key = env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY missing in .env.local");

const blocks = [...readFileSync("docs/agents.md", "utf8").matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());
const [interviewerPrompt, tutorPrompt] = blocks;

const skipTurn = { type: "system", name: "skip_turn", description: "Stay silent when the user is narrating or thinking aloud.", params: { system_tool_type: "skip_turn" } };

const agents = [
  {
    envKey: "ELEVENLABS_INTERVIEWER_AGENT_ID",
    name: "Torchbearer - Interviewer",
    prompt: interviewerPrompt,
    firstMessage: "Hi, I'm Torchbearer. Go ahead and show me how you do this task. I'll mostly listen, and ask when you pause.",
  },
  {
    envKey: "ELEVENLABS_TUTOR_AGENT_ID",
    name: "Torchbearer - Tutor",
    prompt: tutorPrompt,
    firstMessage: "Hi, I'm Torchbearer. I'll guide you through this the way your team's expert does it, and only speak up when you pause. Start whenever you're ready.",
  },
];

async function api(method, path, body) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method,
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

let envText = readFileSync(ENV, "utf8");
for (const a of agents) {
  const body = {
    name: a.name,
    conversation_config: {
      // Expressive mode makes the LLM sprinkle audio tags like [slow] that slow the voice down mid-sentence.
      // Same voice and speech settings on any account, so a new account's agents sound and listen the same.
      tts: { model_id: "eleven_v4_turbo", voice_id: "cjVigY5qzO86Huf0OWal", expressive_mode: false },
      asr: { provider: "scribe_realtime", quality: "high", user_input_audio_format: "pcm_16000" },
      // The app reads the live transcript and agent replies from these events.
      conversation: {
        max_duration_seconds: 600,
        client_events: ["audio", "interruption", "agent_response", "user_transcript", "agent_response_correction", "agent_tool_response"],
      },
      // People go quiet for a long time while they work; the app decides when to check in ([IDLE]),
      // so ElevenLabs' own 7 s "Are you still there?" nudge stays out of the way.
      turn: { turn_timeout: 30 },
      agent: {
        first_message: a.firstMessage,
        language: "en",
        prompt: { prompt: a.prompt, llm: "gemini-2.5-flash", temperature: 0.4, built_in_tools: { skip_turn: skipTurn } },
      },
    },
  };
  const existing = env[a.envKey];
  if (existing) {
    await api("PATCH", `/v1/convai/agents/${existing}`, body);
    console.log(`updated ${a.name}: ${existing}`);
  } else {
    const { agent_id } = await api("POST", "/v1/convai/agents/create", body);
    envText = envText.replace(new RegExp(`^${a.envKey}=.*$`, "m"), `${a.envKey}=${agent_id}`);
    console.log(`created ${a.name}: ${agent_id}`);
  }
}
writeFileSync(ENV, envText);
