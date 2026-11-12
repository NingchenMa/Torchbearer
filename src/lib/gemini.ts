// Server-only Gemini helper: JSON output, falls through a model list on overload.

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

// Fast models first: gemini-3.8-flash and gemini-flash-latest ran past 60 s in tests on 2026-11-10.
export const TEXT_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
const MINIMAL_THINKING = new Set(["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]);
export const VISION_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"];

export async function geminiJson<T>(
  system: string,
  parts: Part[],
  models = TEXT_MODELS,
  // Total time for all model attempts. Hosting platforms cut requests off (AWS Amplify at ~30 s),
  // so give up in time to return a clean error; the client simply tries again with the next frame.
  budgetMs = Number(process.env.GEMINI_BUDGET_MS) || 25_000,
  // Share of the time left that one model may use before the next is tried. Raise it for slow,
  // heavy requests (many images) that a lighter fallback can't answer in the few seconds left anyway.
  share = 0.6,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY missing in .env.local" };

  const deadline = Date.now() + budgetMs;
  let last = "";
  for (const [i, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left < 1_000) return { ok: false, error: last || `Gemini took longer than ${budgetMs / 1000}s` };
    // A model that hangs must not use up the whole budget: leave the next models time to answer.
    const isLast = i === models.length - 1;
    const wait = isLast ? left : Math.min(left, Math.max(8_000, Math.round(left * share)));
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            // Flash Lite answers about twice as fast with minimal thinking, with the same quality on screen reading.
            ...(MINIMAL_THINKING.has(model) ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
          },
        }),
        signal: AbortSignal.timeout(wait),
      });
    } catch {
      last = `Gemini ${model} took longer than ${Math.round(wait / 1000)}s`;
      continue;
    }
    if (!res.ok) {
      last = `Gemini ${model} ${res.status}: ${await res.text()}`;
      if ([404, 429, 500, 503].includes(res.status)) continue;
      return { ok: false, error: last };
    }
    const json = await res.json();
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, error: `Gemini ${model} returned invalid JSON: ${text.slice(0, 200)}` };
    }
  }
  return { ok: false, error: last || `Gemini took longer than ${budgetMs / 1000}s` };
}
