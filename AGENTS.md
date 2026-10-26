# zsh-llm agent guidance

Keep README.md limited to human setup and usage. Implementation decisions,
provider behavior, verification notes and maintenance instructions belong here.
Do not commit evaluations, generated media, benchmark logs or credentials.

## Scope and structure

- `bin/zsh-llm.js`: CLI, output contract and system prompt.
- `lib/runtime.js`: bounded subprocesses, cancellation and selected environment
  context. Never dump the environment, history, directory contents or project
  instructions into the model prompt.
- `lib/providers.js`: native CLI authentication and isolated provider calls.
- `share/zsh-llm.zsh`: static ZLE integration. Loading it must start no process.
  Empty input is a no-op; failure preserves the buffer and cursor. Never execute
  a generated suggestion or add an automatic provider fallback.

The repository is the fleet's shell runtime. `~/bin/zsh-llm` launches Bun against
the canonical checkout. Placement is declared in
`~/dev/my/shared/workspaces.json`; runtime preparation is
`workspace install zsh-llm`. Do not deploy remote changes or alter shared fleet
configuration unless the task requests it.

## Provider contract

Defaults: Claude `sonnet` with high effort, Codex `gpt-6-luna` with high effort,
Grok `grok-4.7` with its native effort default. Keep provider model selection
explicit; do not resolve to a different provider when a model or login fails.
CLI flags and native aliases can change; verify installed CLI help before edits.
Use the current model generation when updating defaults or running comparisons;
verify the native catalog and official documentation instead of reusing an old
model name. GPT-6 Luna was verified on soyo on 2026-10-26; do not substitute
GPT-5.6 Luna. Explicit user model selections remain explicit.

The old Responses API and macOS Shortcut backends were removed. Do not restore
API-key, endpoint, temperature or shortcut routing implicitly. Retired
`ZSH_LLM_API_KEY`, `ZSH_LLM_ENDPOINT`, `ZSH_LLM_TEMPERATURE` and
`ZSH_LLM_MACOS_SHORTCUT` have no effect. Legacy `ZSH_LLM_MODEL` is also ignored:
old terminal environments set it to an OpenAI model, which must never override
Claude's default. Models resolve from `--model`, then the selected provider's
`ZSH_LLM_{CLAUDE,CODEX,GROK}_MODEL`, then its default. Reject known model/provider
mismatches before spawning a CLI; never infer or switch the provider implicitly.

Use native executables. Fleet `~/bin/{claude,codex,grok}` links target `agent-run`,
which reloads the personal environment; the helper bypasses those links.
`ZSH_LLM_{CLAUDE,CODEX,GROK}_BIN` can explicitly select a native executable.
Never insert prompt text into a shell command used to launch a provider.

### Authentication and temporary state

Each request owns a private `mkdtemp` directory. Provider working directories,
`TMPDIR`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `GROK_HOME` are beneath it.
Remove it after success, error, timeout, SIGINT, SIGTERM or SIGHUP, after stopping
the provider process group. SIGKILL and machine failure cannot run cleanup.
Never recursively delete a caller-supplied home or a native auth directory.

Reuse host-local account authentication; never copy credentials between hosts.
API keys and inherited provider configuration variables are removed from child
environments. The global `HOME` remains unchanged for ordinary native behavior;
provider configuration homes are temporary.

- Claude: use an existing `CLAUDE_CODE_OAUTH_TOKEN`, then a subscription
  setup-token from the original `settings.json`, then an unexpired access token
  from the original `.credentials.json`. Keep it in the child environment only.
  Never borrow the refresh token into the temporary home. Keychain-only logins
  require a subscription setup-token; do not introduce additional Keychain
  permissions or silently fall back to API billing.
- Codex: require native file-based account auth. Only `auth.json` is symlinked
  from its original host directory into the temporary `CODEX_HOME`; force file
  auth and ChatGPT login. Codex 0.164 writes auth refreshes through this symlink
  using truncate/write. Recheck persistence semantics before changing this
  strategy or upgrading assumptions; losing a refreshed token in tmp can break
  the original login. Do not copy the whole `.codex` directory.
- Grok: `GROK_AUTH_PATH` references the original host auth file. The temporary
  `GROK_HOME` contains only a minimal configuration. Never copy `auth.json` or
  install/sync plugins on the request path.

### Isolation

Claude uses `--safe-mode`, not `--bare`: bare mode excludes account OAuth.
Disable all tools, MCP servers, slash commands, Chrome integration and session
persistence. Streaming init must report empty `tools`, `mcp_servers` and `skills`;
abort if that contract changes. Native built-in plugin modules may remain listed
even in safe mode; installed user plugins must not load.

Grok disables compatibility discovery for Cursor/Claude/Codex, managed MCP and
gateway tools, memory, workflows, bundled subagents and relay. `--tools ""`
alone did not yield an empty tool catalog in 1.0.70. Use the verified nonempty
allowlist followed by denylist in the adapter, including `search_tool` and
`use_tool`, and audit streaming init for empty catalogs. A non-off sandbox keeps
the session off the shared leader; never kill the user's global Grok leaders.

Codex disables user config, project instructions, host/bundled skills, plugins,
apps, hooks, memory, shell tools, web search and subagents. Replace the coding
agent prompt with the small helper prompt. Some model-advertised built-in tools
can remain; do not claim a globally empty catalog. Keep read-only sandboxing,
abort tool events and require a completed turn before accepting output.

## Environment and prompt

The host code captures context; the model must not inspect the computer.
The ZLE widget passes the running Zsh version and selected live options on each
invocation, without exporting persistent variables or starting a process.
Standalone CLI calls inspect their parent process and probe only a recognized
shell's `--version`. `$SHELL` is a labelled fallback, never proof of the active
shell. `--shell` overrides detection; `--context` prints the selected non-secret
context without making a model call. Missing options/versions stay unknown.

Always append runtime context, even with `--system` or `ZSH_LLM_SYSTEM`.
Quote literal shell metacharacters, while retaining intentional expansions.
In particular, unquoted optional FFmpeg maps such as `0:a?` fail under Zsh
NOMATCH. Keep generic prompt rules short; avoid hard-coded ffmpeg recipes or a
blanket requirement that commands terminate (servers and `tail -f` are valid).

Opus 5.5 and Grok 4.7 reviewed the prompt on 2026-10-26. Adopted points:
distinguish argument quoting from quoting the entire response, bind syntax to
the actual shell/options, cover partial commands, and use UPPER_CASE placeholders
for essential unknowns instead of overly frequent empty responses. Neither
review authorizes tool execution or automatic application.

## Verification and language choice

Do not create or run routine automated test suites unless requested or an
explicit CI gate requires them. Use proportionate syntax checks, `--help`,
`--context`, diff inspection and safe operational readback. Model/FFmpeg smoke
checks must use disposable directories and synthetic inputs, never user media.
Check cleanup and buffer preservation when touching process lifecycle or ZLE.
Do not turn an LLM result into an `eval` inside the helper. The optional shell
syntax check uses parse-only `-n`, with startup files disabled; it does not prove
that command arguments or tool semantics are correct.

Keep Bun for now. The helper has no package dependencies, and ten local
`bun bin/zsh-llm.js --help` launches on soyo measured a 2026-10-26 median startup
of 11.1 ms (10.3–18.7 ms). Provider startup/inference took seconds in the prior
comparison. A Rust rewrite would add native builds and cross-platform packaging
without evidence of a material end-to-end benefit. Reconsider only after a
measured runtime/distribution problem or a changed dependency requirement.
