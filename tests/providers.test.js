const test = require('node:test');
const assert = require('node:assert');

const { normalizeProviderName, resolveConfig } = require('../providers');
const openai = require('../providers/openai');
const openRouter = require('../providers/open-router');
const claude = require('../providers/claude');

const inputs = (values) => (name) => values[name] || '';

test('provider names are normalised, aliases accepted, unknown ones rejected', () => {
  assert.strictEqual(normalizeProviderName(''), 'openai');
  assert.strictEqual(normalizeProviderName(undefined), 'openai');
  assert.strictEqual(normalizeProviderName(' Claude '), 'claude');
  assert.strictEqual(normalizeProviderName('anthropic'), 'claude');
  assert.strictEqual(normalizeProviderName('OpenRouter'), 'open-router');
  assert.strictEqual(normalizeProviderName('open-router'), 'open-router');
  assert.throws(() => normalizeProviderName('gemini'), /Unknown provider "gemini"/);
  assert.throws(() => normalizeProviderName('../openai'), /Unknown provider/);
});

test('defaults to openai and keeps the old openai_* inputs working', () => {
  const cfg = resolveConfig(inputs({ openai_api_key: 'k1', openai_model: 'gpt-6-luna' }), {});
  assert.strictEqual(cfg.provider, 'openai');
  assert.strictEqual(cfg.model, 'gpt-6-luna');
  assert.strictEqual(cfg.apiKey, 'k1');
});

test('provider and model come from the environment when inputs are empty', () => {
  const cfg = resolveConfig(inputs({}), { AI_PROVIDER: 'claude', CLAUDE_API_KEY: 'ck', ANTHROPIC_WORKSPACE_ID: 'ws' });
  assert.strictEqual(cfg.provider, 'claude');
  assert.strictEqual(cfg.model, 'claude-haiku-5-5');
  assert.strictEqual(cfg.apiKey, 'ck');
  assert.strictEqual(cfg.workspaceId, 'ws');
});

test('inputs win over the environment', () => {
  const cfg = resolveConfig(
    inputs({ provider: 'open-router', model: 'qwen/qwen3.8-flash', openrouter_api_key: 'in' }),
    { AI_PROVIDER: 'claude', AI_MODEL: 'x', OPENROUTER_API_KEY: 'env' },
  );
  assert.deepStrictEqual([cfg.provider, cfg.model, cfg.apiKey], ['open-router', 'qwen/qwen3.8-flash', 'in']);
});

test('openai_model does not leak into other providers', () => {
  const cfg = resolveConfig(inputs({ provider: 'open-router', openai_model: 'gpt-5.6-luna' }), { OPENROUTER_API_KEY: 'k' });
  assert.strictEqual(cfg.model, openRouter.DEFAULT_MODEL);
});

test('a missing key names where to put it', () => {
  assert.throws(() => resolveConfig(inputs({ provider: 'claude' }), {}), /anthropic_api_key.*ANTHROPIC_API_KEY, CLAUDE_API_KEY/);
  assert.throws(() => resolveConfig(inputs({}), {}), /openai_api_key/);
});

test('openai: reasoning models get reasoning_effort and no temperature', () => {
  for (const model of ['gpt-5.6-luna', 'gpt-6-luna', 'o4-mini']) {
    const body = openai.buildRequest({ system: 's', user: 'u', model, temperature: 0.7 });
    assert.strictEqual(body.reasoning_effort, 'low', model);
    assert.strictEqual(body.temperature, undefined, model);
  }
  const legacy = openai.buildRequest({ system: 's', user: 'u', model: 'gpt-4o', temperature: 0.3 });
  assert.strictEqual(legacy.temperature, 0.3);
  assert.strictEqual(legacy.reasoning_effort, undefined);
});

function fakeFetch(responses) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const next = responses.shift();
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test('open-router: posts the chat completions format with auth and attribution', async () => {
  const f = fakeFetch([{ status: 200, body: { choices: [{ message: { content: ' Hello ' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } } }]);
  try {
    const result = await openRouter.generate({ system: 's', user: 'u', model: 'qwen/qwen3.8-flash', apiKey: 'or-key' });
    assert.deepStrictEqual(result, { text: 'Hello', usage: { input: 10, output: 2 } });
    assert.strictEqual(f.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.strictEqual(f.calls[0].options.headers.Authorization, 'Bearer or-key');
    assert.deepStrictEqual(f.calls[0].body.reasoning, { effort: 'low' });
    assert.strictEqual(f.calls[0].body.temperature, undefined);
  } finally {
    f.restore();
  }
});

test('http: retries 429 and 5xx, fails fast on other 4xx', async () => {
  const sleep = async () => {};
  let f = fakeFetch([
    { status: 429, body: { error: 'slow down' } },
    { status: 503, body: { error: 'busy' } },
    { status: 200, body: { choices: [{ message: { content: 'ok' } }] } },
  ]);
  try {
    const result = await openai.generate({ system: 's', user: 'u', model: 'gpt-5.6-luna', apiKey: 'k' }, { sleep });
    assert.strictEqual(result.text, 'ok');
    assert.strictEqual(f.calls.length, 3);
  } finally {
    f.restore();
  }

  f = fakeFetch([{ status: 400, body: { error: { message: 'bad model' } } }]);
  try {
    await assert.rejects(openai.generate({ system: 's', user: 'u', model: 'nope', apiKey: 'k' }, { sleep }), /OpenAI API request failed \(400\)/);
    assert.strictEqual(f.calls.length, 1);
  } finally {
    f.restore();
  }
});

test('http: an empty answer is an error that names the finish reason', async () => {
  const f = fakeFetch([{ status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } }]);
  try {
    await assert.rejects(openRouter.generate({ system: 's', user: 'u', model: 'm', apiKey: 'k' }), /empty description \(finish_reason: length\)/);
  } finally {
    f.restore();
  }
});

test('claude: effort only for models that take it; text read by block type', async () => {
  assert.deepStrictEqual(claude.buildRequest({ system: 's', user: 'u', model: 'claude-haiku-5-5' }).output_config, { effort: 'low' });
  assert.deepStrictEqual(claude.buildRequest({ system: 's', user: 'u', model: 'claude-opus-4-8' }).output_config, { effort: 'low' });
  assert.strictEqual(claude.buildRequest({ system: 's', user: 'u', model: 'claude-haiku-4-5' }).output_config, undefined);

  let sent;
  const client = {
    messages: {
      create: async (request) => {
        sent = request;
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: ' Summary ' }],
          usage: { input_tokens: 7, output_tokens: 3 },
        };
      },
    },
  };
  const result = await claude.generate({ system: 'sys', user: 'u', model: 'claude-haiku-5-5', apiKey: 'k' }, { client });
  assert.deepStrictEqual(result, { text: 'Summary', usage: { input: 7, output: 3 } });
  assert.strictEqual(sent.system, 'sys');
  assert.strictEqual(sent.temperature, undefined);
});

test('claude: refusals and empty answers are errors', async () => {
  const respond = (response) => ({ messages: { create: async () => response } });
  await assert.rejects(
    claude.generate({ system: 's', user: 'u', model: 'claude-haiku-5-5', apiKey: 'k' }, { client: respond({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }) }),
    /declined.*cyber/,
  );
  await assert.rejects(
    claude.generate({ system: 's', user: 'u', model: 'claude-haiku-5-5', apiKey: 'k' }, { client: respond({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] }) }),
    /empty description \(stop_reason: max_tokens\)/,
  );
});
