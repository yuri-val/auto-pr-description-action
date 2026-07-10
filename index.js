const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

// gpt-5.6 models have a 400k-token context window; 100k chars (~25k tokens)
// keeps plenty of headroom while covering most real-world PRs untruncated.
const MAX_DIFF_LENGTH = 100000;
const AUTO_DESCRIPTION_MARKER = '> `AUTO DESCRIPTION`';

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

    let diffOutput = execSync(`git diff origin/${baseRef}...origin/${headRef}`, { encoding: 'utf8' });

    if (!diffOutput.trim()) {
      console.log('No diff found between branches. Skipping description generation.');
      return;
    }

    if (diffOutput.length > MAX_DIFF_LENGTH) {
      console.log(`Diff too large (${diffOutput.length} chars), truncating to ${MAX_DIFF_LENGTH} chars.`);
      diffOutput = diffOutput.substring(0, MAX_DIFF_LENGTH) + '\n... [diff truncated]';
    }

    const generatedDescription = await generateDescription(diffOutput, openaiApiKey, openaiModel, temperature);

    await updatePRDescription(githubToken, context, prNumber, generatedDescription);

    core.setOutput('pr_number', prNumber.toString());
    core.setOutput('description', generatedDescription);
    console.log(`Successfully updated PR #${prNumber} description.`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Lean system prompt tuned for GPT-5.6 (see
// https://developers.openai.com/api/docs/guides/latest-model): concise
// instructions outperform long rule lists and cut token usage.
const SYSTEM_PROMPT = `You write GitHub pull request descriptions.

The user message contains the git diff of the PR. From it, produce the PR description body in GitHub Markdown:
- Start with a 1-2 sentence summary of the change.
- Group the changes into sections with emoji headings (e.g. ✨ Features, 🐛 Fixes, 🔧 Maintenance); include only sections that apply.
- Describe user-visible impact, not file-by-file mechanics.

Output only the description body — no title, no preamble, no code fences around the whole answer.`;

async function generateDescription(diffOutput, openaiApiKey, openaiModel, temperature) {
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
        content: diffOutput,
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

async function updatePRDescription(githubToken, context, prNumber, generatedDescription) {
  const octokit = github.getOctokit(githubToken);

  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
  });

  const currentDescription = pullRequest.body || '';
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

run();
