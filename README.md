# zsh-llm-helper

Lightweight CLI that sends your current Zsh buffer + a system prompt to the OpenAI Responses API and injects the generated command back into the prompt. Perfect for fast LLM-powered command completion bound to a single key.

## Features

- `zsh-llm` CLI talks directly to the Responses API with a configurable model, endpoint, and system prompt.
- On macOS, `zsh-llm` can optionally route prompts through a local Shortcuts workflow instead of the API client.
- `--init zsh` emits a Zsh-friendly integration that binds a key (default `Alt-\`) to the CLI so it can rewrite the current buffer in-place.
- Environment variables let you point at any API endpoint and key without touching the script.

## Installation

The fleet uses the canonical checkout at `~/dev/zsh-llm` and the shared
`~/bin/zsh-llm` shell launcher. Prepare it with `workspace install zsh-llm`.
The launcher executes Bun directly; no global package copy or Python process
is required. Source `~/dev/zsh-llm/share/zsh-llm.zsh` to install the input widget
without launching Bun during shell startup.

Outside the fleet, run `bun bin/zsh-llm.js` from this checkout or add your own
shell launcher pointing to it.

## Configuration

| Env var | Description | Default |
| --- | --- | --- |
| `ZSH_LLM_API_KEY` | OpenAI API key (falls back to `OPENAI_API_KEY`) | _required_ |
| `ZSH_LLM_ENDPOINT` | API endpoint | `https://api.openai.com/v1/responses` |
| `ZSH_LLM_MODEL` | Model name (e.g. `gpt-5.4-mini`) | `gpt-5.4-mini` |
| `ZSH_LLM_SYSTEM` | System prompt template | `Return only the command to be executed as a raw string, no markdown, no fenced code, no explanation. The shell is $shell on $platform.` |
| `ZSH_LLM_REASONING_EFFORT` | Reasoning effort passed to Responses API (`none`, `low`, `medium`, `high`) | `none` |
| `ZSH_LLM_TEMPERATURE` | Temperature passed to Responses API. Set to `-1` to omit `temperature` from the request. | `0` |
| `ZSH_LLM_MACOS_SHORTCUT` | On `darwin`, run this exact shortcut directly instead of the API client. | unset |
| `ZSH_LLM_BINDKEY` | Key sequence to trigger the integration | `Alt-\` |

## macOS Shortcut Mode

If you prefer Apple Shortcuts on macOS, set the local shortcut name:

```bash
export ZSH_LLM_MACOS_SHORTCUT="zsh-llm-chatgpt"
```

When `zsh-llm` runs on `darwin`, it will:

1. Send this text to the configured shortcut via stdin: `<system prompt> User prompt: <your shell buffer>`.
2. Print the sanitized shortcut output to stdout.
3. Report a shortcut failure without switching to another provider.

There is no `shortcuts list` discovery process on the request path.
`ZSH_LLM_API_KEY` is not required in shortcut mode. Without a configured shortcut,
the existing Responses API configuration remains available.

The shortcut used for this repo is available here:
https://www.icloud.com/shortcuts/3ef13907eb0b44e8a33c9ab2e2b3a262

The extracted local workflow actions are committed in [shortcuts/zsh-llm-chatgpt.actions.plist](shortcuts/zsh-llm-chatgpt.actions.plist).

1. `Use ChatGPT` with the shortcut input token as the prompt.
2. `Stop and output` the `Response` value as text.

## Zsh integration

```bash
# Load the maintained integration directly; no helper process starts here.
source ~/dev/zsh-llm/share/zsh-llm.zsh
```

The snippet binds `Alt-\` to the helper by default. You can change the key at runtime:

```bash
export ZSH_LLM_BINDKEY=$'\e>'  # bind Alt->
source ~/dev/zsh-llm/share/zsh-llm.zsh
```

When the binding runs, it:
1. Takes `$BUFFER` (the current line) and sends it to the configured shortcut or Responses API with the system prompt. Empty input does nothing.
2. Replaces the buffer with the LLM's reply, if any, otherwise restores the original text.
3. Resets the prompt so you can review or run the suggested command. It never executes the reply automatically. The binding is installed in both Emacs and vi insert mode.

## CLI usage

```bash
zsh-llm "undo last commit"
```

You can also override every option inline:

```bash
zsh-llm --model "gpt-5.4-mini" --system "You are a safe shell assistant." "ls /tmp"
```

Responses are printed directly to stdout so your shell integration can capture them without extra formatting, and a small spinner/`Generating…` indicator animates on stderr while the model is thinking.
