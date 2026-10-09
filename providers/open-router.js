const { postJson, chatCompletionText } = require('./http');

const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// OpenRouter speaks the OpenAI chat completions format and normalises the
// differences between the models behind it. `reasoning.effort` is its unified
// knob: reasoning models think briefly, the rest ignore it. No temperature —
// several reasoning models behind the router reject a custom one.
function buildRequest({ system, user, model }) {
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 4096,
    reasoning: { effort: 'low' },
  };
}

/**
 * @param {{ system: string, user: string, model: string, apiKey: string }} request
 * @param {object} [deps] test seams, see http.postJson
 * @returns {Promise<{ text: string, usage: { input: number, output: number } }>}
 */
async function generate(request, deps = {}) {
  const data = await postJson(
    'OpenRouter',
    API_URL,
    {
      Authorization: `Bearer ${request.apiKey}`,
      // Optional attribution headers OpenRouter shows in its dashboards.
      'HTTP-Referer': 'https://github.com/yuri-val/auto-pr-description-action',
      'X-Title': 'auto-pr-description-action',
    },
    buildRequest(request),
    deps,
  );
  const usage = data.usage || {};
  return {
    text: chatCompletionText('OpenRouter', data),
    usage: { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 },
  };
}

module.exports = { name: 'open-router', DEFAULT_MODEL, buildRequest, generate };
