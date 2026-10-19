// Gemini adapter. Implements the common provider interface every adapter must follow:
//   async generate({ systemPrompt, userPrompt, model }) -> { text, tokensUsed, raw }
//
// Talks to Gemini's REST API directly via fetch -- no SDK dependency, consistent with
// this project's existing style (plain nodemailer/multer/etc., no heavy wrapper libs).
// Verified against Gemini's actual documented request/response shape (not assumed):
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   Header: x-goog-api-key
//   Body:   { system_instruction: { parts: [{ text }] }, contents: [{ role: 'user', parts: [{ text }] }] }
//   Response text lives at: data.candidates[0].content.parts[0].text
//
// Free-tier rate limits (as of the model chosen in Settings, mid-2026 figures):
//   gemini-1.5-flash: 15 RPM, 1,500 RPD, 1,000,000 TPM -- most generous free-tier option.
// This adapter does not itself enforce those limits (the scheduler and the manual-trigger
// route are the right places to guard against exceeding them); it does surface a clear
// error when Gemini returns 429 so the caller can log/report it accurately.

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

async function generate({ systemPrompt, userPrompt, model }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in .env -- AI generation cannot run without it.');
  }
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('userPrompt is required.');
  }

  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
  };
  if (systemPrompt && systemPrompt.trim()) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    throw new Error(`Network error calling Gemini: ${networkErr.message}`);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Surface Gemini's own error detail when present, since these codes are meaningful
    // and the caller (AIManager) logs this into ai_generation_log for later review.
    const detail = data && data.error && data.error.message ? data.error.message : response.statusText;
    if (response.status === 429) {
      throw new Error(`Gemini rate limit hit (429): ${detail}`);
    }
    if (response.status === 403) {
      throw new Error(`Gemini rejected the API key (403): ${detail}`);
    }
    throw new Error(`Gemini API error (${response.status}): ${detail}`);
  }

  const candidate = data && data.candidates && data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]
    ? candidate.content.parts[0].text
    : null;

  if (!text) {
    // Gemini can return a 200 with no usable text (e.g. content blocked by safety filters).
    // Surface that clearly rather than silently returning an empty draft.
    const finishReason = candidate && candidate.finishReason;
    throw new Error(`Gemini returned no text${finishReason ? ` (finishReason: ${finishReason})` : ''}.`);
  }

  // Gemini's usageMetadata gives token counts when present; not guaranteed on every
  // response shape, so this degrades gracefully to null rather than throwing.
  const tokensUsed = data && data.usageMetadata && typeof data.usageMetadata.totalTokenCount === 'number'
    ? data.usageMetadata.totalTokenCount
    : null;

  return { text, tokensUsed, raw: data };
}

module.exports = { generate };
