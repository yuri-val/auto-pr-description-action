const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

async function run() {
  try {
    // Inputs
    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const openaiModel = core.getInput('openai_model') || 'gpt-4o-mini';
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

    // Set up Git
    execSync(`git config --global user.name "github-actions[bot]"`);
    execSync(`git config --global user.email "github-actions[bot]@users.noreply.github.com"`);

    // Fetch branches
    execSync(`git fetch origin ${baseRef} ${headRef}`);

    // Get the diff
    const diffOutput = execSync(`git diff origin/${baseRef} origin/${headRef}`, { encoding: 'utf8' });

    // Generate the PR description
    const generatedDescription = await generateDescription(diffOutput, openaiApiKey, openaiModel, temperature);

    // Update the PR
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
      temperature: temperature,
      max_tokens: 1024,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`OpenAI API Error: ${data.error.message}`);
  }

  const description = data.choices[0].message.content.trim();
  return description;
}

async function updatePRDescription(githubToken, context, prNumber, generatedDescription) {
  const octokit = github.getOctokit(githubToken);

  try {
    // Fetch the current PR description
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
    });

    let currentDescription = pullRequest.body || '';
    let newDescription = `> \`AUTO DESCRIPTION\`
> by [auto-pr-description-action](https://github.com/yuri-val/auto-pr-description-action)
\n${generatedDescription}`;

    if (currentDescription && !currentDescription.startsWith('> `AUTO DESCRIPTION`')) {
      console.log('Creating comment with original description...');
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: `**Original description**:\n\n${currentDescription}`
      });
      console.log('Comment created successfully.');
    }

    // Update the PR with the new description
    console.log('Updating PR description...');
    await octokit.rest.pulls.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
      body: newDescription,
    });
    console.log('PR description updated successfully.');

  } catch (error) {
    console.error('Error in updatePRDescription:', error);
    throw error;  // Re-throw the error to be caught in the main try-catch block
  }
}

run();
