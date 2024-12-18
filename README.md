# 🤖 Auto-generate PR Description Action: Supercharge Your Pull Requests!

This GitHub Action leverages OpenAI's cutting-edge language models to automatically craft detailed, insightful pull request descriptions. Say goodbye to vague PR summaries and hello to clear, concise, and context-rich descriptions that enhance your team's collaboration and code review process.

## 🚀 Features

- Automatically generates detailed PR descriptions
- Uses OpenAI's powerful language models
- Customizable OpenAI model and temperature settings
- Supports GitHub Actions workflow
- Fetches diff content and commit messages for context


## 📝 ToDo

- [ ] Handles rate limiting and retries API calls
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
    types: [opened, synchronize]

jobs:
  generate-description:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
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
| `openai_model` | OpenAI model to use (e.g., gpt-4, gpt-3.5-turbo) | No | gpt-4o-mini |
| `github_token` | GitHub token with repo permissions | Yes | ${{ github.token }} |
| `temperature` | Sampling temperature for OpenAI (0.0 to 1.0) | No | 0.7 |

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
