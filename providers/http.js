// JSON-over-HTTP helper shared by the providers that speak the OpenAI chat
// completions format (OpenAI itself, OpenRouter). Claude goes through its SDK.

// A hung request would otherwise hold the job until the 6h job limit.
const REQUEST_TIMEOUT_MS = 180000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;

/**
 * POST a JSON body and return the parsed response. Retries rate limits, 5xx
 * and network errors/timeouts with exponential backoff; any other 4xx is a
 * request problem and fails straight away.
 * @param {string} label provider name used in error messages
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {object} body
 * @param {{ sleep?: (ms: number) => Promise<void> }} [deps]
 */
async function postJson(label, url, headers, body, deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt++) {
    let retryable;
    let failure;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        return await response.json();
      }
      const errorText = await response.text();
      failure = new Error(`${label} API request failed (${response.status}): ${errorText.slice(0, 1000)}`);
      retryable = response.status === 429 || response.status >= 500;
    } catch (error) {
      failure = new Error(`${label} API request failed: ${error.message}`);
      retryable = true;
    }

    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw failure;
    }
    const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    console.log(`${failure.message} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms...`);
    await sleep(delay);
  }
}

/**
 * The text of a chat completions response, or an error naming the provider.
 * @param {string} label
 * @param {any} data
 * @returns {string}
 */
function chatCompletionText(label, data) {
  if (data && data.error) {
    throw new Error(`${label} API error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (typeof content !== 'string' || !content.trim()) {
    const reason = choice && choice.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : '';
    throw new Error(`${label} returned an empty description${reason}.`);
  }
  return content.trim();
}

module.exports = { postJson, chatCompletionText, REQUEST_TIMEOUT_MS, MAX_ATTEMPTS };
