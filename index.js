const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

const MAX_DIFF_LENGTH = 30000;
const AUTO_DESCRIPTION_MARKER = '> `AUTO DESCRIPTION`';

async function run() {
  try {
    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const openaiModel = core.getInput('openai_model') || 'gpt-5.4-mini';
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

async function generateDescription(diffOutput, openaiApiKey, openaiModel, temperature) {
  const prompt = `**Instructions:**

Please generate a **Pull Request description** for the provided diff, following these guidelines:
- Add appropriate emojis to the description.
- Do **not** include the words "Title" and "Description" in your output.
- Format your answer in **Markdown**.

**Diff:**
${diffOutput}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant who generates pull request descriptions based on diffs.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature,
      max_tokens: 1024,
    }),
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
