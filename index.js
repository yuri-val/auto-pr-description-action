const core = require('@actions/core');
const github = require('@actions/github');
const { execFileSync } = require('child_process');

const {
  AUTO_DESCRIPTION_MARKER,
  SYSTEM_PROMPT,
  buildUserMessage,
  filterTrustedComments,
  neutralizeClosingKeywords,
} = require('./context');
const { resolveConfig } = require('./providers');

async function run() {
  try {
    const ai = resolveConfig((name) => core.getInput(name), process.env);
    const githubToken = core.getInput('github_token', { required: true });
    console.log(`Provider: ${ai.provider}, model: ${ai.model}.`);

    const context = github.context;

    if (context.eventName !== 'pull_request') {
      core.setFailed('This action only runs on pull_request events.');
      return;
    }

    const pullRequest = context.payload.pull_request;
    const prNumber = pullRequest.number;
    const prAuthor = pullRequest.user && pullRequest.user.login;

    const octokit = github.getOctokit(githubToken);

    const diffOutput = await getDiff(octokit, context, pullRequest);

    if (!diffOutput.trim()) {
      console.log('No diff found between branches. Skipping description generation.');
      return;
    }

    const currentDescription = pullRequest.body || '';
    const allComments = await collectComments(octokit, context, prNumber);
    const comments = filterTrustedComments(allComments, prAuthor);
    console.log(`Collected ${allComments.length} comment(s) for PR #${prNumber}, using ${comments.length} from trusted authors.`);

    const userMessage = buildUserMessage({ diff: diffOutput, currentDescription, comments });

    const trustedText = [currentDescription, ...comments.map((c) => c.body)].join('\n');
    const started = Date.now();
    const result = await ai.generate({
      system: SYSTEM_PROMPT,
      user: userMessage,
      model: ai.model,
      apiKey: ai.apiKey,
      temperature: ai.temperature,
      workspaceId: ai.workspaceId,
    });
    console.log(`Generated in ${((Date.now() - started) / 1000).toFixed(1)}s — ${result.usage.input} input / ${result.usage.output} output tokens.`);
    const generatedDescription = neutralizeClosingKeywords(result.text, trustedText);

    await updatePRDescription(octokit, context, prNumber, currentDescription, generatedDescription);

    core.setOutput('pr_number', prNumber.toString());
    core.setOutput('description', generatedDescription);
    console.log(`Successfully updated PR #${prNumber} description.`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

/**
 * The PR diff (base...head), fetched through the API so no branch name — which
 * the PR author controls — ever reaches a shell. The API refuses very large
 * diffs; for those, fall back to local git, addressing commits by SHA and
 * passing arguments without a shell.
 */
async function getDiff(octokit, context, pullRequest) {
  const { owner, repo } = context.repo;
  try {
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullRequest.number,
      mediaType: { format: 'diff' },
    });
    return String(data || '');
  } catch (error) {
    console.log(`Could not fetch the diff from the API (${error.message}). Falling back to local git.`);
    return getDiffFromGit(pullRequest);
  }
}

function getDiffFromGit(pullRequest) {
  const baseSha = pullRequest.base && pullRequest.base.sha;
  const headSha = pullRequest.head && pullRequest.head.sha;
  if (!/^[0-9a-f]{40,64}$/i.test(baseSha || '') || !/^[0-9a-f]{40,64}$/i.test(headSha || '')) {
    throw new Error('The pull_request payload has no valid base/head SHA.');
  }

  const git = (args) => execFileSync('git', args, {
    encoding: 'utf8',
    // execFileSync defaults to a 1 MB buffer and throws ENOBUFS beyond it; the
    // diff is truncated later, so allow a big one through.
    maxBuffer: 256 * 1024 * 1024,
  });

  try {
    git(['fetch', '--no-tags', 'origin', baseSha, headSha]);
    return git(['diff', `${baseSha}...${headSha}`]);
  } catch (error) {
    throw new Error(`Local git diff failed (${error.message}). The fallback needs the repository checked out with actions/checkout and fetch-depth: 0.`);
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
      map: (c) => ({ kind: 'comment', ...authorOf(c), body: c.body }),
    },
    {
      kind: 'review',
      fetch: () => octokit.paginate(octokit.rest.pulls.listReviews, {
        owner, repo, pull_number: prNumber, per_page: 100,
      }),
      map: (r) => ({ kind: `review:${(r.state || '').toLowerCase()}`, ...authorOf(r), body: r.body }),
    },
    {
      kind: 'review comment',
      fetch: () => octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner, repo, pull_number: prNumber, per_page: 100,
      }),
      map: (c) => ({
        kind: 'review comment',
        ...authorOf(c),
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

function authorOf(item) {
  return {
    author: item.user && item.user.login,
    authorType: item.user && item.user.type,
    authorAssociation: item.author_association,
  };
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

module.exports = { run, getDiff, collectComments, updatePRDescription };
