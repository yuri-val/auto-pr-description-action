# Auto-generate PR Description Action

This GitHub Action automatically generates pull request descriptions using OpenAI when a PR is created or updated.

## 🚀 Features

- Automatically generates detailed PR descriptions
- Uses OpenAI's powerful language models
- Customizable OpenAI model and temperature settings
- Supports GitHub Actions workflow

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
    steps:
      - uses: actions/checkout@v2
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
