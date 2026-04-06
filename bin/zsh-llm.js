#!/usr/bin/env bun

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_SYSTEM_PROMPT_TEMPLATE =
  "Return only the command to be executed as a raw string, no markdown, no fenced code, no explanation. The shell is $shell on $platform.";
const SUPPORTED_SHELLS = new Set(["zsh"]);

function parseArgs(argv) {
  const opts = { _: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-s":
      case "--system":
        opts.system = argv[++i];
        break;
      case "-m":
      case "--model":
        opts.model = argv[++i];
        break;
      case "-k":
      case "--key":
        opts.key = argv[++i];
        break;
      case "-e":
      case "--endpoint":
        opts.endpoint = argv[++i];
        break;
      case "-i":
      case "--init":
        opts.init = argv[++i];
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--":
        opts._.push(...argv.slice(i + 1));
        i = argv.length;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        opts._.push(arg);
    }
  }
  return opts;
}

function helpText() {
  return `Usage: zsh-llm [options] <command>

Options:
  -i, --init SHELL     print the integration snippet for the supported shell (zsh)
  -s, --system PROMPT  custom system prompt to send before the command
  -m, --model MODEL    override the model (default from environment or ${DEFAULT_MODEL})
  -k, --key KEY        API key (defaults to ZSH_LLM_API_KEY or OPENAI_API_KEY)
  -e, --endpoint URL   API endpoint (defaults to ${DEFAULT_ENDPOINT})
  -h, --help           show this message

You can also set env vars: ZSH_LLM_API_KEY, ZSH_LLM_ENDPOINT, ZSH_LLM_MODEL, ZSH_LLM_SYSTEM, ZSH_LLM_REASONING_EFFORT, ZSH_LLM_TEMPERATURE, ZSH_LLM_MACOS_SHORTCUT.
`;
}

function resolveEndpoint(opt) {
  return (
    opt ||
    process.env.ZSH_LLM_ENDPOINT ||
    process.env.OPENAI_API_ENDPOINT ||
    process.env.OPENAI_API_BASE ||
    DEFAULT_ENDPOINT
  );
}

function resolveKey(opt) {
  return (
    opt ||
    process.env.ZSH_LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY_SECRET
  );
}

function resolveModel(opt) {
  return opt || process.env.ZSH_LLM_MODEL || DEFAULT_MODEL;
}

function resolveSystem(opt) {
  if (opt) return opt;
  if (process.env.ZSH_LLM_SYSTEM) return process.env.ZSH_LLM_SYSTEM;
  const shell = path.basename(process.env.SHELL || "sh");
  const platform = process.platform;
  return DEFAULT_SYSTEM_PROMPT_TEMPLATE.replace("$shell", shell).replace("$platform", platform);
}

function resolveReasoningEffort() {
  const value = (process.env.ZSH_LLM_REASONING_EFFORT || "none").trim().toLowerCase();
  const allowed = new Set(["none", "low", "medium", "high"]);
  if (!allowed.has(value)) {
    throw new Error("Invalid ZSH_LLM_REASONING_EFFORT; expected one of: none, low, medium, high.");
  }
  return value;
}

function resolveTemperature() {
  const raw = process.env.ZSH_LLM_TEMPERATURE;
  if (raw === undefined || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error("Invalid ZSH_LLM_TEMPERATURE; expected a number or -1 to omit temperature.");
  }
  return value < 0 ? null : value;
}

function resolveMacOSShortcutName() {
  const value = process.env.ZSH_LLM_MACOS_SHORTCUT?.trim();
  return value ? value : null;
}

function buildShortcutPrompt(systemPrompt, prompt) {
  return `${systemPrompt} User prompt: ${prompt}`;
}

async function runCommand(command, args, { input } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });

    child.stdin.end(input);
  });
}

async function hasShortcut(name) {
  if (!name || process.platform !== "darwin") {
    return false;
  }
  try {
    const { stdout } = await runCommand("shortcuts", ["list"]);
    const shortcuts = new Set(
      stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
    );
    return shortcuts.has(name);
  } catch {
    return false;
  }
}

async function queryShortcut(shortcutName, input) {
  const { stdout } = await runCommand("shortcuts", ["run", shortcutName, "--input-path", "-"], { input });
  return stdout;
}

async function query(apiEndpoint, key, payload) {
  const response = await fetch(apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || JSON.stringify(body);
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
  return body;
}

function extractText(result) {
  if (!result) return null;
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      const candidate = extractText(item);
      if (candidate) return candidate;
    }
  }
  if (result?.content) {
    return extractText(result.content);
  }
  if (result?.text) {
    return result.text;
  }
  if (result?.output_text) {
    return result.output_text;
  }
  return null;
}

function sanitizeCommandOutput(message) {
  const trimmed = message.trim();
  const fencedBlock = trimmed.match(/^```(?:[\w.+-]+)?\n([\s\S]*?)\n```$/);
  if (fencedBlock) {
    return fencedBlock[1].trim();
  }
  return trimmed;
}

function startSpinner(message = "Generating…") {
  if (!process.stderr.isTTY) {
    return () => {};
  }
  const frames = ["-", "\\", "|", "/"];
  let idx = 0;
  const interval = setInterval(() => {
    const frame = frames[idx % frames.length];
    process.stderr.write(`\r${message} ${frame}`);
    idx += 1;
  }, 100);
  return () => {
    clearInterval(interval);
    process.stderr.write("\r" + " ".repeat(message.length + 2) + "\r");
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(helpText());
    return;
  }
  if (opts.init) {
    if (!SUPPORTED_SHELLS.has(opts.init)) {
      throw new Error(`Supported shells: ${[...SUPPORTED_SHELLS].join(", ")}`);
    }
    const integration = await fs.readFile(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "share", `zsh-llm.${opts.init}`), "utf8");
    console.log(integration);
    return;
  }

  const prompt = opts._.join(" ").trim();
  if (!prompt) {
    console.error("Please provide the command you want to rewrite.");
    console.log(helpText());
    process.exit(1);
  }

  const systemPrompt = resolveSystem(opts.system);
  const macOSShortcutName = resolveMacOSShortcutName();
  if (await hasShortcut(macOSShortcutName)) {
    const stopSpinner = startSpinner(`Generating via shortcut:${macOSShortcutName}…`);
    try {
      const result = await queryShortcut(macOSShortcutName, buildShortcutPrompt(systemPrompt, prompt));
      if (!result.trim()) {
        throw new Error(`Shortcut "${macOSShortcutName}" returned no output.`);
      }
      console.log(sanitizeCommandOutput(result));
      return;
    } finally {
      stopSpinner();
    }
  }

  const apiKey = resolveKey(opts.key);
  if (!apiKey) {
    throw new Error("Missing API key; set ZSH_LLM_API_KEY, OPENAI_API_KEY, or pass --key.");
  }
  const apiEndpoint = resolveEndpoint(opts.endpoint);
  const model = resolveModel(opts.model);
  const reasoningEffort = resolveReasoningEffort();
  const temperature = resolveTemperature();

  const payload = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    top_p: 1,
    max_output_tokens: 300,
    reasoning: { effort: reasoningEffort },
  };
  if (temperature !== null) {
    payload.temperature = temperature;
  }

  const stopSpinner = startSpinner(`Generating via model:${model}…`);
  let result;
  try {
    result = await query(apiEndpoint, apiKey, payload);
  } finally {
    stopSpinner();
  }
  const message = extractText(result.output) || extractText(result);
  if (!message) {
    throw new Error("Response does not include output text.");
  }
  console.log(sanitizeCommandOutput(message));
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
