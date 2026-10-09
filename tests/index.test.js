const test = require('node:test');
const assert = require('node:assert');

const { getDiff } = require('../index');

const context = { repo: { owner: 'o', repo: 'r' } };

test('getDiff reads the diff from the API, never from a branch name', async () => {
  let request;
  const octokit = {
    rest: {
      pulls: {
        get: async (params) => {
          request = params;
          return { data: 'diff --git a/x b/x\n+1' };
        },
      },
    },
  };
  const pullRequest = {
    number: 7,
    head: { ref: 'evil$(touch /tmp/pwned)', sha: 'a'.repeat(40) },
    base: { ref: 'main', sha: 'b'.repeat(40) },
  };
  const diff = await getDiff(octokit, context, pullRequest);
  assert.strictEqual(diff, 'diff --git a/x b/x\n+1');
  assert.deepStrictEqual(request, { owner: 'o', repo: 'r', pull_number: 7, mediaType: { format: 'diff' } });
});

test('the git fallback refuses anything that is not a commit SHA', async () => {
  const octokit = { rest: { pulls: { get: async () => { throw new Error('diff too large'); } } } };
  const pullRequest = {
    number: 7,
    head: { ref: 'x', sha: '$(touch /tmp/pwned)' },
    base: { ref: 'main', sha: 'b'.repeat(40) },
  };
  await assert.rejects(getDiff(octokit, context, pullRequest), /no valid base\/head SHA/);
});
