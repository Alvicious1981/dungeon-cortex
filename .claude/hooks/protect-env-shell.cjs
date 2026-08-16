#!/usr/bin/env node
"use strict";

// PreToolUse guard for Bash/PowerShell: blocks any command that directly
// references a sensitive .env* file (any name/path form, Windows or POSIX),
// while leaving .env.example untouched. Complements the native Read/Edit/Write
// deny rules in .claude/settings.json, which don't cover shell tool calls.

const ENV_REFERENCE = /(^|[\/\\\s"'`=:(),;|&<>])\.env(\.[A-Za-z0-9_.-]+)?(?=$|[\/\\\s"'`=:)(,;|&<>])/gi;

function isExampleFile(suffix) {
  const token = ("." + "env" + (suffix || "")).toLowerCase();
  return token.endsWith(".example");
}

function findBlockedReference(command) {
  ENV_REFERENCE.lastIndex = 0;
  let match;
  while ((match = ENV_REFERENCE.exec(command)) !== null) {
    if (!isExampleFile(match[2])) {
      return match[0].trim();
    }
  }
  return null;
}

function main(rawInput) {
  let input;
  try {
    input = rawInput.trim() ? JSON.parse(rawInput) : {};
  } catch (err) {
    // Malformed hook input: this hook is defense-in-depth on top of the
    // native Read/Edit/Write deny rules, so fail open rather than block
    // unrelated tool calls on a parse error.
    process.exit(0);
    return;
  }

  const toolName = input.tool_name || "";
  if (toolName !== "Bash" && toolName !== "PowerShell") {
    process.exit(0);
    return;
  }

  const command = (input.tool_input && input.tool_input.command) || "";
  if (!command) {
    process.exit(0);
    return;
  }

  const blocked = findBlockedReference(command);
  if (blocked) {
    process.stderr.write(
      "Blocked: " + toolName + " command references a sensitive env file (" + blocked + ").\n"
    );
    process.exit(2);
    return;
  }

  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => main(raw));
