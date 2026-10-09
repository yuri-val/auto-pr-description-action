// Picks the model provider. Each provider is its own module with the same
// shape: { name, DEFAULT_MODEL, generate({ system, user, model, ... }) }.

const PROVIDERS = {
  openai: require('./openai'),
  claude: require('./claude'),
  'open-router': require('./open-router'),
};

const ALIASES = {
  anthropic: 'claude',
  openrouter: 'open-router',
  open_router: 'open-router',
};

const DEFAULT_PROVIDER = 'openai';

// Where each provider's key may come from: the action input first, then the
// environment (in the order listed).
const KEY_SOURCES = {
  openai: { input: 'openai_api_key', env: ['OPENAI_API_KEY'] },
  claude: { input: 'anthropic_api_key', env: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] },
  'open-router': { input: 'openrouter_api_key', env: ['OPENROUTER_API_KEY'] },
};

/**
 * @param {string} raw provider name as configured (case-insensitive, aliases allowed)
 * @returns {string} canonical provider name
 */
function normalizeProviderName(raw) {
  const name = String(raw || '').trim().toLowerCase();
  if (!name) return DEFAULT_PROVIDER;
  const canonical = ALIASES[name] || name;
  if (!PROVIDERS[canonical]) {
    throw new Error(`Unknown provider "${raw}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`);
  }
  return canonical;
}

/**
 * Resolve provider, model and credentials from action inputs and the
 * environment. Inputs win over environment variables, so a workflow can set
 * AI_PROVIDER / AI_MODEL once at job level and override per step.
 * @param {(name: string) => string} getInput returns '' for an unset input
 * @param {Record<string, string | undefined>} env
 */
function resolveConfig(getInput, env) {
  const provider = normalizeProviderName(getInput('provider') || env.AI_PROVIDER);
  const module = PROVIDERS[provider];

  const model = getInput('model')
    || env.AI_MODEL
    // The original, OpenAI-only input keeps working.
    || (provider === 'openai' ? getInput('openai_model') : '')
    || module.DEFAULT_MODEL;

  const sources = KEY_SOURCES[provider];
  const apiKey = getInput(sources.input) || sources.env.map((name) => env[name]).find(Boolean) || '';
  if (!apiKey) {
    throw new Error(`No API key for provider "${provider}": set the "${sources.input}" input or one of ${sources.env.join(', ')}.`);
  }

  const temperature = parseFloat(getInput('temperature') || '0.7');

  return {
    provider,
    model,
    apiKey,
    temperature,
    workspaceId: getInput('anthropic_workspace_id') || env.ANTHROPIC_WORKSPACE_ID || '',
    generate: module.generate,
  };
}

module.exports = { PROVIDERS, DEFAULT_PROVIDER, normalizeProviderName, resolveConfig };
