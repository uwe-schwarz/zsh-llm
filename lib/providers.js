import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executable, readJson, runCommand } from "./runtime.js";

export const PROVIDERS = {
  claude: { model: "sonnet", effort: "high" },
  codex: { model: "gpt-6-luna", effort: "high" },
  grok: { model: "grok-4.7" },
};

export function resolveModel(provider, override) {
  const model = override || process.env[`ZSH_LLM_${provider.toUpperCase()}_MODEL`] || PROVIDERS[provider].model;
  const owner = /^(?:gpt-|o\d)/.test(model) ? "codex"
    : /^(?:claude-|sonnet(?:$|[-\[])|opus(?:$|[-\[])|haiku(?:$|[-\[])|fable(?:$|[-\[]))/.test(model) ? "claude"
      : /^grok(?:$|-)/.test(model) ? "grok" : null;
  if (owner && owner !== provider) throw new Error(`Model "${model}" belongs to ${owner}, not ${provider}. Use --provider ${owner} or choose a ${provider} model.`);
  return model;
}

async function providerBinary(provider) {
  const override = process.env[`ZSH_LLM_${provider.toUpperCase()}_BIN`];
  if (override) {
    const binary = await executable(override);
    if (!binary) throw new Error(`Provider executable not found: ${override}`);
    return binary;
  }
  const home = os.homedir();
  const found = await executable(provider);
  // The fleet wrapper reloads the personal environment. Use its native target.
  if (found && path.basename(await fs.realpath(found)) !== "agent-run") return found;
  for (const candidate of [path.join(home, ".local/bin", provider), path.join(home, ".local/share/mise/shims", provider), ...(provider === "grok" ? [path.join(home, ".grok/bin/grok")] : [])]) {
    const binary = await executable(candidate);
    if (binary) return binary;
  }
  throw new Error(`Install ${provider} and sign in before using this provider.`);
}

function providerEnvironment(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|CODEX_|OPENAI_|GROK_|XAI_|ZSH_LLM_)/.test(key) || ["BASH_ENV", "ENV", "ZDOTDIR"].includes(key)) delete env[key];
  }
  return { ...env, TMPDIR: root, TMP: root, TEMP: root, NO_COLOR: "1" };
}

function isolatedEvent(event) {
  if (event.type !== "system" || event.subtype !== "init") return;
  for (const name of ["tools", "mcp_servers", "skills"]) {
    if (!Array.isArray(event[name]) || event[name].length) throw new Error(`Provider isolation failed: ${name} is not empty.`);
  }
}

async function streamResult(binary, args, options) {
  let result, initialized = false;
  await runCommand(binary, args, { ...options, onEvent(event) {
    isolatedEvent(event);
    if (event.type === "system" && event.subtype === "init") initialized = true;
    if (event.type === "result") result = event;
  } });
  if (!initialized) throw new Error("Provider initialization was not verified.");
  if (!result || result.is_error || (result.subtype && result.subtype !== "success")) throw new Error(result?.result || "Provider did not return a successful result.");
  if (typeof result.result !== "string") throw new Error("Provider response has no command text.");
  return result.result;
}

async function claudeToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const settings = await readJson(path.join(home, "settings.json"));
  const setupToken = settings?.env?.CLAUDE_CODE_OAUTH_TOKEN;
  if (typeof setupToken === "string" && setupToken.trim()) return setupToken;
  const credentials = (await readJson(path.join(home, ".credentials.json")))?.claudeAiOauth;
  // Borrow the access token, not the refresh token, so an ephemeral home cannot
  // rotate and then discard the host's persistent browser credentials.
  if (credentials?.accessToken && Number(credentials.expiresAt) > Date.now() + 120_000) return credentials.accessToken;
  throw new Error("No reusable Claude subscription token found. Refresh your Claude login, or use a Claude setup-token via CLAUDE_CODE_OAUTH_TOKEN.");
}

async function queryClaude(binary, request, env) {
  const { root, model, effort, system, prompt, signal, timeout } = request;
  env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
  await fs.mkdir(env.CLAUDE_CONFIG_DIR);
  env.CLAUDE_CODE_OAUTH_TOKEN = await claudeToken();
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  const args = ["--safe-mode", "--tools", "", "--disallowedTools", "*", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--no-session-persistence", "--no-chrome", "--permission-mode", "dontAsk", "--system-prompt", system, "--model", model, "--verbose", "--output-format", "stream-json", "--print"];
  if (effort) args.push("--effort", effort);
  return streamResult(binary, args, { cwd: root, env, input: prompt, signal, timeout });
}

async function queryCodex(binary, request, env) {
  const { root, model, effort, system, prompt, signal, timeout } = request;
  const authHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const authFile = path.resolve(authHome, "auth.json");
  try { await fs.access(authFile); }
  catch { throw new Error("A file-based Codex account login is required; sign in with codex -c 'cli_auth_credentials_store=\"file\"' login."); }
  env.CODEX_HOME = path.join(root, "codex");
  await fs.mkdir(env.CODEX_HOME);
  // File auth storage in Codex 0.164 writes through this host-local symlink.
  await fs.symlink(authFile, path.join(env.CODEX_HOME, "auth.json"));
  const instructions = path.join(root, "system.txt");
  await fs.writeFile(instructions, system);
  const config = {
    cli_auth_credentials_store: "file", forced_login_method: "chatgpt", approval_policy: "never",
    web_search: "disabled", project_doc_max_bytes: 0, model_instructions_file: instructions,
    include_environment_context: false, include_permissions_instructions: false,
    include_apps_instructions: false, include_collaboration_mode_instructions: false,
    "skills.bundled.enabled": false, "skills.include_instructions": false,
    "tools.update_plan.enabled": false, "tools.experimental_request_user_input.enabled": false,
    "features.skip_host_skill_discovery": true, suppress_unstable_features_warning: true,
  };
  for (const feature of ["plugins", "apps", "hooks", "memories", "shell_snapshot", "shell_tool", "unified_exec", "image_generation", "view_image", "tool_suggest", "skill_search", "skill_mcp_dependency_install", "multi_agent", "multi_agent_v2", "goals", "sleep_tool", "current_time_reminder"]) config[`features.${feature}`] = false;
  if (effort) config.model_reasoning_effort = effort;
  const args = ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--json", "--model", model];
  for (const [key, value] of Object.entries(config)) args.push("-c", `${key}=${JSON.stringify(value)}`);
  args.push("-");
  let text, complete = false;
  await runCommand(binary, args, { cwd: root, env, input: prompt, signal, timeout, onEvent(event) {
    if (event.type === "turn.failed" || event.type === "error") throw new Error(event.error?.message || event.message || "Codex request failed.");
    if (event.item && !["agent_message", "reasoning"].includes(event.item.type)) throw new Error("Codex attempted to use a tool instead of returning a command.");
    if (event.type === "item.completed" && event.item?.type === "agent_message") text = event.item.text;
    if (event.type === "turn.completed") complete = true;
  } });
  if (!complete || typeof text !== "string") throw new Error("Codex did not return a command.");
  return text;
}

async function queryGrok(binary, request, env) {
  const { root, model, effort, system, prompt, signal, timeout } = request;
  const authFile = process.env.GROK_AUTH_PATH || path.join(process.env.GROK_HOME || path.join(os.homedir(), ".grok"), "auth.json");
  try { await fs.access(authFile); }
  catch { throw new Error("Sign in on this host with grok login --device-auth."); }
  env.GROK_HOME = path.join(root, "grok");
  env.GROK_AUTH_PATH = path.resolve(authFile);
  env.CLAUDE_CONFIG_DIR = path.join(root, "empty-claude");
  await fs.mkdir(env.GROK_HOME);
  const config = [
    "[skills]", `ignore = ${JSON.stringify([os.homedir(), root])}`,
    "[managed_mcps]", "enabled = false", "gateway_tools_enabled = false",
    "[memory]", "enabled = false", "[workflows]", "enabled = false",
    "[subagents]", "enabled = false", "[features]", "subagent_bundle = false",
    "[relay]", "enabled = false", "[cli]", "auto_update = false",
  ].join("\n");
  await fs.writeFile(path.join(env.GROK_HOME, "config.toml"), config);
  for (const name of ["DISABLE_AUTOUPDATER", "DISABLE_EXPERIMENTS"]) env[`GROK_${name}`] = "1";
  for (const name of ["MANAGED_MCPS_ENABLED", "MANAGED_MCP_GATEWAY_TOOLS_ENABLED", "MEMORY", "WORKFLOWS", "SUBAGENT_BUNDLE"]) env[`GROK_${name}`] = "0";
  for (const vendor of ["CURSOR", "CLAUDE", "CODEX"]) for (const surface of ["SKILLS", "RULES", "AGENTS", "MCPS", "HOOKS", "SESSIONS"]) env[`GROK_${vendor}_${surface}_ENABLED`] = "false";
  const promptFile = path.join(root, "prompt.txt");
  await fs.writeFile(promptFile, prompt, { mode: 0o600 });
  const args = ["--cwd", root, "--leader-socket", path.join(root, "grok.sock"), "--sandbox", "read-only", "--verbatim", "--tools", "read_file", "--disallowed-tools", "read_file,CallMcpTool,FetchMcpResource,ListMcpResources,search_tool,use_tool", "--deny", "MCPTool", "--no-plan", "--no-subagents", "--disable-web-search", "--permission-mode", "dontAsk", "--max-turns", "1", "--system-prompt-override", system, "--model", model, "--output-format", "streaming-messages-json", "--prompt-file", promptFile];
  if (effort) args.push("--effort", effort);
  return streamResult(binary, args, { cwd: root, env, signal, timeout });
}

export async function generateCommand(request) {
  const binary = await providerBinary(request.provider);
  const env = providerEnvironment(request.root);
  const query = { claude: queryClaude, codex: queryCodex, grok: queryGrok }[request.provider];
  return query(binary, request, env);
}
