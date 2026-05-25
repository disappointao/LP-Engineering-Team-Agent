import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROFILE_CHECKS = [
  {
    label: "OpenAI-compatible",
    api: "openai-completions",
    baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL",
    apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    modelEnv: "OPENAI_COMPATIBLE_DEFAULT_MODEL"
  },
  {
    label: "Anthropic-compatible",
    api: "anthropic-messages",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_DEFAULT_MODEL"
  }
];

function parseArgs(argv) {
  const options = {
    envFile: ".env.local",
    strict: false,
    help: false,
    errors: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--env-file") {
      const next = argv[index + 1];

      if (!next || next.startsWith("--")) {
        options.errors.push("--env-file requires a file path");
      } else {
        options.envFile = next;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      const value = arg.slice("--env-file=".length);
      if (value) {
        options.envFile = value;
      } else {
        options.errors.push("--env-file requires a file path");
      }
      continue;
    }

    options.errors.push(`Unknown option: ${arg}`);
  }

  return options;
}

function parseEnv(content) {
  const env = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const separatorIndex = withoutExport.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    const rawValue = withoutExport.slice(separatorIndex + 1).trim();
    env[key] = unquoteEnvValue(rawValue);
  }

  return env;
}

function unquoteEnvValue(value) {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  const last = value[value.length - 1];

  if ((quote === "\"" || quote === "'") && last === quote) {
    return value.slice(1, -1);
  }

  return value;
}

function hasValue(env, key) {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

function checkProfile(env, profile) {
  const missing = [profile.baseUrlEnv, profile.apiKeyEnv, profile.modelEnv].filter(
    (key) => !hasValue(env, key)
  );

  return {
    ...profile,
    ready: missing.length === 0,
    missing
  };
}

function formatProfile(profile) {
  const lines = [
    `${profile.label} profile: ${profile.ready ? "ready" : "not ready"}`
  ];

  if (!profile.ready) {
    lines.push(`  Missing: ${profile.missing.join(", ")}`);
  }

  lines.push("  Web Models fields:");
  lines.push(`  api: ${profile.api}`);
  lines.push(`  baseUrl: copy from ${profile.baseUrlEnv}`);
  lines.push(`  apiKeyEnv: ${profile.apiKeyEnv}`);
  lines.push(`  model: copy from ${profile.modelEnv}`);

  return lines;
}

function usage() {
  return [
    "Usage: pnpm real-provider:doctor [--env-file <path>] [--strict]",
    "",
    "Checks local real-provider readiness without network calls.",
    "Values for API keys and base URLs are never printed."
  ].join("\n");
}

export async function runDoctor({ cwd = process.cwd(), argv = [] } = {}) {
  const options = parseArgs(argv);
  const lines = [];

  if (options.help) {
    return { exitCode: 0, stdout: `${usage()}\n`, stderr: "" };
  }

  if (options.errors.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${options.errors.join("\n")}\n${usage()}\n`
    };
  }

  const envPath = resolve(cwd, options.envFile);
  let env = {};

  lines.push("Real provider doctor");
  lines.push(`Env file: ${options.envFile}`);
  lines.push("Network: no checks performed");
  lines.push("");

  try {
    env = parseEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      lines.push(`Env file not found: ${options.envFile}`);
      lines.push("");
    } else {
      throw error;
    }
  }

  const runtimeEnabled = env.REAL_MODEL_RUNTIME === "1";

  if (runtimeEnabled) {
    lines.push("REAL_MODEL_RUNTIME is enabled");
  } else {
    lines.push("REAL_MODEL_RUNTIME is not enabled");
  }

  lines.push("");

  const profiles = PROFILE_CHECKS.map((profile) => checkProfile(env, profile));

  for (const profile of profiles) {
    lines.push(...formatProfile(profile));
    lines.push("");
  }

  const readyProfiles = profiles.filter((profile) => profile.ready);

  if (readyProfiles.length === 0) {
    lines.push("No ready real-provider profile");
  } else {
    lines.push(
      `Ready real-provider profiles: ${readyProfiles
        .map((profile) => profile.label)
        .join(", ")}`
    );
  }

  const strictFailure = options.strict && (!runtimeEnabled || readyProfiles.length === 0);

  if (strictFailure) {
    lines.push("Strict mode: failed");
  } else if (options.strict) {
    lines.push("Strict mode: passed");
  } else {
    lines.push("Checklist mode: completed");
  }

  return {
    exitCode: strictFailure ? 1 : 0,
    stdout: `${lines.join("\n")}\n`,
    stderr: ""
  };
}

async function main() {
  const result = await runDoctor({ argv: process.argv.slice(2) });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
