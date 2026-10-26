# zsh-llm

Turn a request or unfinished command into a shell command. Suggestions use
Claude Sonnet by default and stay in your input buffer until you press Enter.

## Setup

Requires Bun and the Claude Code CLI with subscription authentication. Managed
fleet machines already have the required credentials. Elsewhere, provide a
subscription setup-token from `claude setup-token` through
`CLAUDE_CODE_OAUTH_TOKEN`; saved file-based Claude logins are also supported.
No API key is needed.

On managed machines:

```sh
workspace install zsh-llm
```

Add this to your Zsh configuration:

```sh
source ~/dev/zsh-llm/share/zsh-llm.zsh
```

## Usage

Type a request or partial command, then press **Alt-\\**. Review the suggestion
and press Enter to run it. The managed Ghostty binding is **Ctrl-+**.

```sh
zsh-llm "find the ten largest files below this directory"
zsh-llm --provider codex "undo the last Git commit but keep my changes"
zsh-llm --provider grok "convert input.mp4 to a smaller MP4"
```

Codex and Grok need their own account login on the current machine. Select a
default with `ZSH_LLM_PROVIDER`; override a model with `--model` or
`ZSH_LLM_CLAUDE_MODEL`, `ZSH_LLM_CODEX_MODEL`, or `ZSH_LLM_GROK_MODEL`.
The old global `ZSH_LLM_MODEL` is ignored.
Use `zsh-llm --help` for other options.

For direct use from a checkout, run `bun bin/zsh-llm.js "your request"`.
