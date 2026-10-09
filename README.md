# 🤖 Auto-generate PR Description Action: Supercharge Your Pull Requests!

This GitHub Action leverages OpenAI's cutting-edge language models to automatically craft detailed, insightful pull request descriptions. Say goodbye to vague PR summaries and hello to clear, concise, and context-rich descriptions that enhance your team's collaboration and code review process.

## 🚀 Features

- Automatically generates detailed PR descriptions
- Uses OpenAI's powerful language models
- Customizable OpenAI model and temperature settings
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
- **Secrets are not sent to OpenAI.** The hunks of `.env*`, `*.pem`, `*.key`, `*.p12`/`*.pfx`,
  SSH keys, `master.key`, `credentials.*`/`secrets.*` config files and similar are replaced by a
  placeholder before the diff leaves the runner.
- **Bounded runtime.** OpenAI requests time out after 3 minutes and are retried on rate limits,
  5xx and network errors with exponential backoff.
- **Fork PRs.** Use the `pull_request` trigger. Do not switch to `pull_request_target` to get
  secrets for fork PRs: the action would then run with a write token for untrusted code changes.


## 📝 ToDo

- [x] Handles rate limiting and retries API calls
- [ ] Configurable prompt templates for description generation
- [ ] Supports multiple languages for generated descriptions

## 📋 Requirements

- GitHub repository
- OpenAI API key

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

3. Add your OpenAI API key to your repository secrets as `OPENAI_API_KEY`.

## ⚙️ Configuration

You can customize the action by providing the following inputs:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `openai_api_key` | Your OpenAI API Key | Yes | N/A |
| `openai_model` | OpenAI model to use (e.g., gpt-5.6-luna, gpt-5.6-terra) | No | gpt-5.6-luna |
| `github_token` | GitHub token with repo permissions | Yes | ${{ github.token }} |
| `temperature` | Sampling temperature (0.0 to 1.0). Ignored for reasoning models (gpt-5.x, o-series) | No | 0.7 |

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

- OpenAI for providing the powerful language models
- GitHub Actions for the seamless integration

---

If you find this action helpful, please consider giving it a ⭐️!
