const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

const {
  AUTO_DESCRIPTION_MARKER,
  SYSTEM_PROMPT,
  buildUserMessage,
} = require('./context');

async function run() {
  try {
    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const openaiModel = core.getInput('openai_model') || 'gpt-5.6-luna';
    const githubToken = core.getInput('github_token', { required: true });
    const temperature = parseFloat(core.getInput('temperature') || '0.7');

    const context = github.context;

    if (context.eventName !== 'pull_request') {
      core.setFailed('This action only runs on pull_request events.');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    const baseRef = context.payload.pull_request.base.ref;
    const headRef = context.payload.pull_request.head.ref;

    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');

    execSync(`git fetch origin ${baseRef} ${headRef}`);

    const diffOutput = execSync(`git diff origin/${baseRef}...origin/${headRef}`, { encoding: 'utf8' });

    if (!diffOutput.trim()) {
      console.log('No diff found between branches. Skipping description generation.');
      return;
    }

    const octokit = github.getOctokit(githubToken);

    const currentDescription = context.payload.pull_request.body || '';
    const comments = await collectComments(octokit, context, prNumber);
    console.log(`Collected ${comments.length} comment(s) for PR #${prNumber}.`);

    const userMessage = buildUserMessage({ diff: diffOutput, currentDescription, comments });

    const generatedDescription = await generateDescription(userMessage, openaiApiKey, openaiModel, temperature);

    await updatePRDescription(octokit, context, prNumber, currentDescription, generatedDescription);

    core.setOutput('pr_number', prNumber.toString());
    core.setOutput('description', generatedDescription);
    console.log(`Successfully updated PR #${prNumber} description.`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

/**
 * Gather the whole PR conversation: issue comments, review summaries and
 * inline code comments. Comment access is best-effort — a token without the
 * matching read scope must not break description generation.
 */
async function collectComments(octokit, context, prNumber) {
  const { owner, repo } = context.repo;
  const comments = [];

  const sources = [
    {
      kind: 'comment',
      fetch: () => octokit.paginate(octokit.rest.issues.listComments, {
        owner, repo, issue_number: prNumber, per_page: 100,
      }),
      map: (c) => ({ kind: 'comment', author: c.user && c.user.login, body: c.body }),
    },
    {
      kind: 'review',
      fetch: () => octokit.paginate(octokit.rest.pulls.listReviews, {
        owner, repo, pull_number: prNumber, per_page: 100,
      }),
      map: (r) => ({ kind: `review:${(r.state || '').toLowerCase()}`, author: r.user && r.user.login, body: r.body }),
    },
    {
      kind: 'review comment',
      fetch: () => octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner, repo, pull_number: prNumber, per_page: 100,
      }),
      map: (c) => ({
        kind: 'review comment',
        author: c.user && c.user.login,
        body: c.body,
        path: c.path,
        line: c.line || c.original_line,
      }),
    },
  ];

  for (const source of sources) {
    try {
      const items = await source.fetch();
      comments.push(...items.map(source.map));
    } catch (error) {
      console.log(`Could not read ${source.kind}s (${error.message}). Continuing without them.`);
    }
  }

  return comments.filter((c) => c.body && c.body.trim());
}

async function generateDescription(userMessage, openaiApiKey, openaiModel, temperature) {
  const isReasoningModel = /^(o[1-9]|gpt-5)/.test(openaiModel);

  const requestBody = {
    model: openaiModel,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ],
    // Reasoning models spend completion tokens on internal reasoning before
    // the visible answer, so the budget needs headroom beyond the description
    // itself.
    max_completion_tokens: 4096,
  };

  if (isReasoningModel) {
    // Reasoning models reject a custom temperature. A short PR summary does
    // not need deep reasoning — "low" keeps responses fast and cheap.
    if (/^gpt-5/.test(openaiModel)) {
      requestBody.reasoning_effort = 'low';
    }
  } else {
    requestBody.temperature = temperature;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`OpenAI API Error: ${data.error.message}`);
  }

  return data.choices[0].message.content.trim();
}

async function updatePRDescription(octokit, context, prNumber, currentDescription, generatedDescription) {
  const newDescription = `${AUTO_DESCRIPTION_MARKER}
> by [auto-pr-description-action](https://github.com/yuri-val/auto-pr-description-action)

${generatedDescription}`;

  if (currentDescription && !currentDescription.startsWith(AUTO_DESCRIPTION_MARKER)) {
    console.log('Creating comment with original description...');
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: `**Original description**:\n\n${currentDescription}`,
    });
    console.log('Comment created successfully.');
  }

  console.log('Updating PR description...');
  await octokit.rest.pulls.update({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
    body: newDescription,
  });
  console.log('PR description updated successfully.');
}

// Only run when GitHub executes the action; requiring the file (tests, tooling)
// must not trigger a real run.
if (require.main === module) {
  run();
}

module.exports = { run, collectComments, generateDescription, updatePRDescription };
