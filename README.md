# 🤖 Auto-generate PR Description Action: Supercharge Your Pull Requests!

This GitHub Action uses OpenAI, Claude or any OpenRouter model to automatically craft detailed, insightful pull request descriptions. Say goodbye to vague PR summaries and hello to clear, concise, and context-rich descriptions that enhance your team's collaboration and code review process.

## 🚀 Features

- Automatically generates detailed PR descriptions
- Three providers — OpenAI (default), Claude and OpenRouter — each in its own module
- Provider and model selectable by input or environment variable
- Supports GitHub Actions workflow
- **Context-aware**: the model sees the diff *plus* the PR's current description and its
  full comment thread (issue comments, review summaries and inline code comments), so
  ticket links, decisions and reviewer concerns survive regeneration

### What the model receives

| Section | Content | Role |
|---|---|---|
| `<diff>` | the PR diff (`base...head`) from the GitHub API | source of truth for **what** changed |
| `<current_description>` | the PR body, labelled as human-written or previously auto-generated | **why** — intent, ticket links, notes to preserve |
| `<comments>` | issue comments, review bodies and inline review comments (with `file:line`) from trusted authors | discussion context, resolved concerns, the archived original description |

Budgets keep the request bounded: 100k chars of diff, 5k of description, 20k of comments
(2k per comment). Anything cut is marked as truncated. Comment reads are best-effort — if
the token lacks the scope, generation still proceeds on the diff alone.

### 🔒 Safety

- **No shell sees PR data.** The diff comes from the GitHub API; branch names, which the PR
  author controls, never reach a command line. Only diffs too large for the API fall back to
  local git, addressed by commit SHA.
- **Only trusted comments reach the model.** On a public repository anyone can comment, and
  the comment thread is part of the prompt. Comments are used only from the repository's
  owners, members and collaborators, the PR author, and the action's own archived copy of the
  original description.
- **Issue-closing keywords are guarded.** A generated `Closes #N` / `Fixes #N` / `Resolves #N`
  is turned into `Refs #N` unless the human-written description or a trusted comment already
  contained that reference — so the model cannot be talked into closing unrelated issues on merge.
- **Secrets are not sent to the provider.** The hunks of `.env*`, `*.pem`, `*.key`, `*.p12`/`*.pfx`,
  SSH keys, `master.key`, `credentials.*`/`secrets.*` config files and similar are replaced by a
  placeholder before the diff leaves the runner.
- **Bounded runtime.** Provider requests time out after 3 minutes and are retried on rate limits,
  5xx and network errors with exponential backoff.
- **Fork PRs.** Use the `pull_request` trigger. Do not switch to `pull_request_target` to get
  secrets for fork PRs: the action would then run with a write token for untrusted code changes.


## 📝 ToDo

- [x] Handles rate limiting and retries API calls
- [ ] Configurable prompt templates for description generation
- [ ] Supports multiple languages for generated descriptions

## 📋 Requirements

- GitHub repository
- An API key for the provider you use: OpenAI, Anthropic (Claude) or OpenRouter

## 🛠️ Installation

1. Create a `.github/workflows/auto-pr-description.yml` file in your repository.
2. Add the following content to the file:

```yaml
name: Auto-generate PR Description
on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  generate-description:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      # Optional: only needed for diffs too large for the GitHub API.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Auto-generate PR Description
        uses: yuri-val/auto-pr-description-action@v1
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

3. Add your provider's API key to your repository secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`).

### 🔀 Providers

| `provider` | Default model | Key (input, or environment variable) |
|---|---|---|
| `openai` (default) | `gpt-6-luna` | `openai_api_key` / `OPENAI_API_KEY` |
| `claude` | `claude-haiku-5-5` | `anthropic_api_key` / `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) |
| `open-router` | `deepseek/deepseek-v4.1-flash` | `openrouter_api_key` / `OPENROUTER_API_KEY` |

Inputs win over environment variables, so the provider can be set once for the whole job:

```yaml
    env:
      AI_PROVIDER: claude
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: yuri-val/auto-pr-description-action@v1
```

Each provider is its own module in `providers/` (`openai.js`, `claude.js`, `open-router.js`).

#### Which model writes best

Measured 2026-10-10 on three real PRs and one 5-commit release (all eight candidates followed
the output rules; times and costs are per description):

| Provider / model | Character | Avg time | Cost |
|---|---|---|---|
| openai / `gpt-6-luna` | shortest, accurate, fewest tokens | 3.5 s | $0.0007 |
| openai / `gpt-5.6-luna` | accurate, somewhat generic | 4.7 s | $0.0016 |
| claude / `claude-haiku-5-5` | most specific; the only model to catch every non-obvious change (e.g. a changed default with an upgrade note) | 4.7 s | $0.0014 |
| open-router / `deepseek/deepseek-v4.1-flash` | detailed and accurate | 4.4 s | $0.0028 |
| open-router / `z-ai/glm-5.3-flash` | detailed, occasional overstatement | 13.9 s | $0.0012 |
| open-router / `xiaomi/mimo-v2.6-flash` | detailed, slower | 15.8 s | $0.0011 |
| open-router / `google/gemini-3.8-flash` | concise, odd grouping, most expensive | 4.6 s | $0.0067 |
| open-router / `qwen/qwen3.8-flash` | long, very slow | 57.9 s | $0.0025 |

## ⚙️ Configuration

You can customize the action by providing the following inputs:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `provider` | `openai`, `claude` or `open-router` (env `AI_PROVIDER`) | No | openai |
| `model` | Model for the provider (env `AI_MODEL`) | No | per provider, see above |
| `openai_api_key` | OpenAI API key (env `OPENAI_API_KEY`) | For `openai` | N/A |
| `anthropic_api_key` | Anthropic API key (env `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`) | For `claude` | N/A |
| `anthropic_workspace_id` | Only for Anthropic keys not scoped to a workspace (env `ANTHROPIC_WORKSPACE_ID`) | No | N/A |
| `openrouter_api_key` | OpenRouter API key (env `OPENROUTER_API_KEY`) | For `open-router` | N/A |
| `openai_model` | Deprecated alias of `model` for `openai` | No | N/A |
| `github_token` | GitHub token with repo permissions | Yes | ${{ github.token }} |
| `temperature` | Sampling temperature (0.0 to 1.0) for non-reasoning OpenAI models only | No | 0.7 |

## 📤 Outputs

The action provides the following outputs:

- `pr_number`: The number of the pull request updated
- `description`: The generated pull request description

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/yuri-val/auto-pr-description-action/issues).

## 📝 License

This project is [MIT](https://opensource.org/licenses/MIT) licensed.

## 👤 Author

**Yuri V**

* GitHub: [@yuri-val](https://github.com/yuri-val)

## 🙏 Acknowledgements

- OpenAI, Anthropic and OpenRouter for the models
- GitHub Actions for the seamless integration

---

If you find this action helpful, please consider giving it a ⭐️!
