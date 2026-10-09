const { postJson, chatCompletionText } = require('./http');

const DEFAULT_MODEL = 'gpt-5.6-luna';
const API_URL = 'https://api.openai.com/v1/chat/completions';

// Reasoning models (o-series, gpt-5 and later) reject a custom temperature and
// spend completion tokens on reasoning before the visible answer.
const REASONING_MODEL_RE = /^(o[1-9]|gpt-([5-9]|[1-9][0-9]))/;

function buildRequest({ system, user, model, temperature }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // Headroom for reasoning tokens on top of the description itself.
    max_completion_tokens: 4096,
  };

  if (REASONING_MODEL_RE.test(model)) {
    // A short PR summary does not need deep reasoning — "low" keeps it fast.
    body.reasoning_effort = 'low';
  } else if (Number.isFinite(temperature)) {
    body.temperature = temperature;
  }
  return body;
}

/**
 * @param {{ system: string, user: string, model: string, apiKey: string, temperature?: number }} request
 * @param {object} [deps] test seams, see http.postJson
 * @returns {Promise<{ text: string, usage: { input: number, output: number } }>}
 */
async function generate(request, deps = {}) {
  const data = await postJson(
    'OpenAI',
    API_URL,
    { Authorization: `Bearer ${request.apiKey}` },
    buildRequest(request),
    deps,
  );
  const usage = data.usage || {};
  return {
    text: chatCompletionText('OpenAI', data),
    usage: { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 },
  };
}

module.exports = { name: 'openai', DEFAULT_MODEL, buildRequest, generate };
