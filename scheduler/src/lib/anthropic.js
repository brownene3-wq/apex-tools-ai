/**
 * Anthropic Claude API wrapper for the scheduler worker.
 *
 * Two entry points:
 *   - claudeChat({ env, system, user, maxTokens })  → string (assistant text)
 *   - claudeJson({ env, system, user, maxTokens })  → parsed JSON object
 *
 * The JSON variant instructs Claude to respond with a single JSON object,
 * strips Markdown code fences if present, and throws on parse failure.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export async function claudeChat({ env, system, user, maxTokens = 4096, temperature = 0.7 }) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${txt.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) {
    throw new Error("Claude returned no text content: " + JSON.stringify(data).slice(0, 300));
  }
  return text;
}

export async function claudeJson({ env, system, user, maxTokens = 4096, temperature = 0.4 }) {
  const reinforcedSystem =
    (system || "") +
    "\n\nReturn ONLY a single valid JSON object. No prose, no Markdown fences, no commentary.";
  const raw = await claudeChat({ env, system: reinforcedSystem, user, maxTokens, temperature });
  return parseJsonLoose(raw);
}

// Tolerant JSON parser: strips ```json fences, finds the outermost {...} if extra text.
function parseJsonLoose(s) {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch (_) {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(t.slice(first, last + 1));
    }
    throw new Error("Claude response was not valid JSON: " + t.slice(0, 300));
  }
}
