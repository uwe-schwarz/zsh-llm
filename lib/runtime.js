import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function executable(command) {
  const candidates = command.includes("/") ? [command] : (process.env.PATH || "").split(path.delimiter).map((dir) => path.join(dir, command));
  for (const candidate of candidates) {
    try { await fs.access(candidate, fs.constants.X_OK); return path.resolve(candidate); } catch {}
  }
  return null;
}

export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read configuration: ${file}`);
  }
}

export function runCommand(command, args, { input, env = process.env, cwd, timeout = 3000, signal, onEvent } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: "pipe", detached: process.platform !== "win32" });
    const out = [], err = [];
    const decoder = new StringDecoder("utf8");
    let failure, killTimer, pending = "", bytes = 0;
    const kill = (name) => {
      try { process.platform === "win32" ? child.kill(name) : process.kill(-child.pid, name); } catch {}
    };
    const stop = (error) => {
      if (failure) return;
      failure = error;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1000);
    };
    const cancel = () => stop(signal.reason || new Error("Request cancelled."));
    const timer = setTimeout(() => stop(new Error(`Request timed out after ${timeout / 1000} seconds.`)), timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { stop(new Error("Provider output exceeded the size limit.")); return; }
      out.push(chunk);
      if (onEvent) {
        pending += decoder.write(chunk);
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (!line.trim()) continue;
          try { onEvent(JSON.parse(line)); } catch (error) { stop(error); }
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) stop(new Error("Provider output exceeded the size limit."));
      else err.push(chunk);
    });
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") stop(error); });
    child.once("error", (error) => { failure ||= new Error(`Could not start ${path.basename(command)}: ${error.code || "unknown error"}.`); });
    child.once("close", (code) => {
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      // Remove provider descendants before the temporary home is deleted.
      kill("SIGKILL");
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}.`));
      else resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function runtimeContext(override, signal) {
  const hint = process.env.ZSH_LLM_SHELL_PATH;
  let shell = override || hint;
  let source = override ? "override" : hint ? "widget" : "parent-process";
  if (!shell) {
    try {
      // Linux comm is just a name, which can resolve to a different version on
      // PATH. Prefer the executable of the actual parent when procfs exists.
      let parent;
      if (process.platform === "linux") {
        try { parent = await fs.readlink(`/proc/${process.ppid}/exe`); } catch {}
      }
      if (!parent) parent = (await runCommand("ps", ["-p", String(process.ppid), "-o", "comm="], { signal })).stdout.trim();
      parent = parent.replace(/^-/, "");
      if (["zsh", "bash", "sh", "dash", "fish", "ksh"].includes(path.basename(parent))) shell = parent;
    } catch { signal?.throwIfAborted(); }
  }
  if (!shell) { shell = process.env.SHELL; source = "login-shell-fallback"; }
  const name = shell ? path.basename(shell).replace(/^-/, "") : "unknown";
  const binary = shell ? await executable(shell) : null;
  let version = !override && source === "widget" ? process.env.ZSH_LLM_SHELL_VERSION?.slice(0, 120) : undefined;
  if (!version && binary && ["zsh", "bash", "fish"].includes(name)) {
    try { version = (await runCommand(binary, ["--version"], { signal })).stdout.split("\n")[0].trim().slice(0, 120); }
    catch { signal?.throwIfAborted(); }
  }
  const options = {};
  if (!override && source === "widget") {
    const allowed = new Set(["nomatch", "glob", "nullglob", "extendedglob", "interactivecomments", "banghist", "nounset", "pipefail"]);
    for (const pair of (process.env.ZSH_LLM_SHELL_OPTIONS || "").split(",")) {
      const [key, value] = pair.split("=");
      if (allowed.has(key) && ["on", "off"].includes(value)) options[key] = value === "on";
    }
  }
  let distribution;
  if (process.platform === "linux") {
    try {
      const release = await fs.readFile("/etc/os-release", "utf8");
      distribution = Object.fromEntries([...release.matchAll(/^(ID|VERSION_ID|PRETTY_NAME)=(.*)$/gm)].map(([, key, value]) => [key, value.replace(/^"|"$/g, "")]));
    } catch {}
  }
  return { shell: { name, path: binary, version: version || "unknown", source, options }, os: { name: os.type(), platform: process.platform, release: os.release(), arch: os.arch(), ...(distribution ? { distribution } : {}) }, cwd: process.cwd() };
}
