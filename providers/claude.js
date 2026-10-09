const { Anthropic } = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-haiku-5-5';

// Models that take `output_config.effort`. Older ones (Haiku 4.5, Sonnet 4.5,
// the 3.x family) reject it, so it is only sent where it is understood.
const EFFORT_MODEL_RE = /^claude-(opus-4-[5-9]|(opus|sonnet|haiku|fable|mythos)-([5-9]|[1-9][0-9]))/;

function buildRequest({ system, user, model }) {
  const request = {
    model,
    // Thinking is on by default on current models and counts toward
    // max_tokens, so leave room beyond the description itself.
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (EFFORT_MODEL_RE.test(model)) {
    // A PR summary is a light task: think briefly, answer fast.
    request.output_config = { effort: 'low' };
  }
  return request;
}

function createClient({ apiKey, workspaceId }) {
  return new Anthropic({
    apiKey,
    // Per attempt; the SDK retries 408/409/429/5xx and connection errors.
    timeout: 180000,
    maxRetries: 3,
    // Keys that are not scoped to a workspace must name one on every request.
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
}

/**
 * @param {{ system: string, user: string, model: string, apiKey: string, workspaceId?: string }} request
 * @param {{ client?: { messages: { create: Function } } }} [deps] test seam
 * @returns {Promise<{ text: string, usage: { input: number, output: number } }>}
 */
async function generate(request, deps = {}) {
  const client = deps.client || createClient(request);
  const response = await client.messages.create(buildRequest(request));

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details && response.stop_details.category;
    throw new Error(`Claude declined to write the description${category ? ` (${category})` : ''}.`);
  }

  // Read text blocks by type: a response can begin with thinking blocks.
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error(`Claude returned an empty description (stop_reason: ${response.stop_reason}).`);
  }

  const usage = response.usage || {};
  return { text, usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 } };
}

module.exports = { name: 'claude', DEFAULT_MODEL, buildRequest, generate };
