# zsh-llm-helper

Lightweight CLI that sends your current Zsh buffer + a system prompt to the OpenAI Responses API and injects the generated command back into the prompt. Perfect for fast LLM-powered command completion bound to a single key.

## Features

- `zsh-llm` CLI talks directly to the Responses API with a configurable model, endpoint, and system prompt.
- `--init zsh` emits a Zsh-friendly integration that binds a key (default `Alt-\`) to the CLI so it can rewrite the current buffer in-place.
- Environment variables let you point at any API endpoint and key without touching the script.

## Installation

```bash
# Install globally with Bun (recommended):
bun add -g .

# Run directly without installing:
bunx ./bin/zsh-llm.js <options> "command text"
```

By default, Bun installs global binaries into `~/.bun/bin`. Make sure that directory is on your `PATH`.
If you prefer `~/.local/bin`, create a symlink there:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.bun/bin/zsh-llm ~/.local/bin/zsh-llm
```

> You can also bring this repository into `/path/to/tool` and run `bunx /path/to/tool/bin/zsh-llm.js` directly without installing.

## Configuration

| Env var | Description | Default |
| --- | --- | --- |
| `ZSH_LLM_API_KEY` | OpenAI API key (falls back to `OPENAI_API_KEY`) | _required_ |
| `ZSH_LLM_ENDPOINT` | API endpoint | `https://api.openai.com/v1/responses` |
| `ZSH_LLM_MODEL` | Model name (e.g. `gpt-5.2`) | `gpt-5.2` |
| `ZSH_LLM_SYSTEM` | System prompt template | `Return only the command to be executed as a raw string, no markdown, no fenced code, no explanation. The shell is $shell on $platform.` |
| `ZSH_LLM_BINDKEY` | Key sequence to trigger the integration | `Alt-\` |

## Zsh integration

```bash
# output the integration snippet and source it
zsh-llm --init zsh > ~/.zsh-llm.sh
source ~/.zsh-llm.sh
```

The snippet binds `Alt-\` to the helper by default. You can change the key at runtime:

```bash
export ZSH_LLM_BINDKEY=$'\e>'  # bind Alt->
source ~/.zsh-llm.sh
```

When the binding runs, it:
1. Takes `$BUFFER` (the current line) and sends it to the Responses API with the system prompt.
2. Replaces the buffer with the LLM's reply, if any, otherwise restores the original text.
3. Resets the prompt so you can review or run the suggested command.

## CLI usage

```bash
zsh-llm "undo last commit"
```

You can also override every option inline:

```bash
zsh-llm --model "gpt-4o-mini" --system "You are a safe shell assistant." "ls /tmp"
```

Responses are printed directly to stdout so your shell integration can capture them without extra formatting, and a small spinner/`Generating…` indicator animates on stderr while the model is thinking.
