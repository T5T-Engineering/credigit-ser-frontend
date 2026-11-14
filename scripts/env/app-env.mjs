#!/usr/bin/env node
/**
 * Deployment environments (dev | test | uat) and the secret / non-secret settings split. Same script in every Credigit SER
 * repository; behaviour comes from `deploy/env/environments.json` (no dependencies, Node 20+).
 *
 *   node scripts/env/app-env.mjs resolve                       print the current environment
 *   node scripts/env/app-env.mjs sync [--env <env>] [--check]  keep .env.<env> (secrets) and the settings file (non-secrets) in step
 *   node scripts/env/app-env.mjs from-secrets --env <env> [--out <file>]
 *                                                              write .env.<env> from GitHub secrets (SECRETS_JSON = toJSON(secrets))
 *   node scripts/env/app-env.mjs run [--env <env>] -- <command…>
 *                                                              run a command with the settings file + .env.<env> loaded
 *
 * Current environment: APP_ENVIRONMENT (CI/CD sets it from the GitHub secret or variable APP_ENVIRONMENT) → the
 * launchSettings.json profile (LAUNCH_PROFILE, else the first profile with APP_ENVIRONMENT) → config `default`.
 *
 * Split rule: a key listed in `secrets` (wildcards allowed) belongs in `.env.<env>` (git-ignored); every other key belongs
 * in the settings file (`appsettings.<Env>.json` for .NET, `.env.<env>.public` for Node), except `processKeys`, which may
 * stay in `.env.<env>`. `sync` moves misplaced keys to the right file and adds every literal secret key to `.env.<env>`
 * (empty until filled). `--check` changes nothing and fails when a settings file holds a secret value (CI runs it).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configPath = join(root, "deploy", "env", "environments.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const envNames = Object.keys(config.environments);

const fail = (message) => {
  console.error(`app-env: ${message}`);
  process.exit(1);
};
const rel = (p) => relative(root, p).replaceAll("\\", "/");

// ---------------------------------------------------------------------------------------------------------------- args
const argv = process.argv.slice(2);
const command = argv[0];
const dashDash = argv.indexOf("--");
const opts = argv.slice(1, dashDash === -1 ? undefined : dashDash);
const flag = (name) => opts.includes(`--${name}`);
const option = (name) => {
  const i = opts.indexOf(`--${name}`);
  return i === -1 ? undefined : opts[i + 1];
};

// -------------------------------------------------------------------------------------------------- environment choice
function fromLaunchSettings() {
  if (!config.launchSettings) return undefined;
  const file = join(root, config.launchSettings);
  if (!existsSync(file)) return undefined;
  const profiles = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")).profiles ?? {};
  const wanted = process.env.LAUNCH_PROFILE;
  const entries = Object.entries(profiles);
  const profile = wanted ? profiles[wanted] : entries.map(([, p]) => p).find((p) => p?.environmentVariables?.APP_ENVIRONMENT);
  if (wanted && !profile) fail(`LAUNCH_PROFILE '${wanted}' is not in ${config.launchSettings}.`);
  return profile?.environmentVariables?.APP_ENVIRONMENT;
}

function currentEnvironment(explicit) {
  const name = (explicit || process.env.APP_ENVIRONMENT || fromLaunchSettings() || config.default || "").trim().toLowerCase();
  if (!envNames.includes(name)) fail(`environment must be one of ${envNames.join(", ")} (got '${name}'). Set APP_ENVIRONMENT or the launchSettings.json profile.`);
  return name;
}

// ------------------------------------------------------------------------------------------------------------- paths
const fill = (pattern, env) => pattern.replaceAll("{env}", env).replaceAll("{Env}", config.environments[env].hostName ?? env);
const secretFileOf = (env) => join(root, fill(config.secretFile ?? ".env.{env}", env));
const settingsFileOf = (env) => join(root, fill(config.settingsFile, env));

// ------------------------------------------------------------------------------------------------------- key matching
const toRegex = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`, "i");
const secretPatterns = (config.secrets ?? []).map(toRegex);
const processPatterns = (config.processKeys ?? []).map(toRegex);
const isSecret = (key) => secretPatterns.some((r) => r.test(key));
const isProcessKey = (key) => processPatterns.some((r) => r.test(key));
const literalSecrets = (config.secrets ?? []).filter((k) => !k.includes("*"));

// ---------------------------------------------------------------------------------------------------------- dotenv io
function parseDotenv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) {
      const quote = value[0];
      value = value.slice(1, -1);
      value = quote === "'" ? value.replaceAll("'\\''", "'") : value.replaceAll('\\"', '"').replaceAll("\\n", "\n");
    }
    out.set(key, value);
  }
  return out;
}
const readDotenv = (file) => (existsSync(file) ? parseDotenv(readFileSync(file, "utf8")) : new Map());
/** Single quotes keep `&`, `$`, `;` and spaces literal for bash `source`, systemd EnvironmentFile and the app loaders. */
const quote = (value) => {
  if (value === "" || /^[A-Za-z0-9_./:@,+=-]+$/.test(value)) return value;
  if (!value.includes("'") && !value.includes("\n")) return `'${value}'`;
  // Node's .env parser has no escape inside single quotes: use double quotes when the value contains one.
  if (!value.includes('"') && !value.includes("\\")) return `"${value.replaceAll("\n", "\\n")}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
};

function writeDotenv(file, header, entries, { secret }) {
  const body = [...header.map((l) => `# ${l}`.trimEnd()), "", ...entries.map(([k, v]) => `${k}=${quote(v)}`), ""].join("\n");
  writeFileSync(file, body);
  if (secret) {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* not supported on every file system */
    }
  }
}

// ----------------------------------------------------------------------------------------------- appsettings (.NET) io
const isIndex = (segment) => /^\d+$/.test(segment);
function flatten(node, prefix = [], out = new Map()) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, [...prefix, String(i)], out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) if (!k.startsWith("$")) flatten(v, [...prefix, k], out);
  } else if (prefix.length) {
    out.set(prefix.join("__"), node === null ? "" : String(node));
  }
  return out;
}
const findKey = (obj, segment) => Object.keys(obj).find((k) => k.toLowerCase() === segment.toLowerCase());
function setPath(rootNode, key, value) {
  const segments = key.split("__");
  let node = rootNode;
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    const nextIsIndex = !last && isIndex(segments[i + 1]);
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (last) node[index] = value;
      else node = node[index] ??= nextIsIndex ? [] : {};
      return;
    }
    const existing = findKey(node, segment) ?? segment;
    if (last) node[existing] = value;
    else node = node[existing] ??= nextIsIndex ? [] : {};
  });
}
function deletePath(rootNode, key) {
  const segments = key.split("__");
  const trail = [];
  let node = rootNode;
  for (const segment of segments) {
    const k = Array.isArray(node) ? Number(segment) : findKey(node, segment);
    if (k === undefined || node[k] === undefined) return;
    trail.push([node, k]);
    node = node[k];
  }
  for (let i = trail.length - 1; i >= 0; i--) {
    const [parent, k] = trail[i];
    const child = parent[k];
    const empty = i === trail.length - 1 || (child && typeof child === "object" && Object.keys(child).length === 0);
    if (!empty) break;
    if (Array.isArray(parent)) parent.splice(k, 1);
    else delete parent[k];
  }
}

/** The settings file of an environment as a flat key map, plus a writer for it. */
function openSettings(env) {
  const file = settingsFileOf(env);
  if (config.settingsFormat === "appsettings") {
    const exists = existsSync(file);
    const json = exists ? JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) : { $comment: `${config.environments[env].hostName} environment. Non-secret settings only; secrets belong in .env.${env} (ADR-0020).` };
    return {
      file,
      values: flatten(json),
      set: (k, v) => setPath(json, k, v),
      remove: (k) => deletePath(json, k),
      save: () => writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`),
    };
  }
  const values = readDotenv(file);
  if (!existsSync(file) && config.publicTemplate && existsSync(join(root, config.publicTemplate))) {
    for (const key of parseDotenv(readFileSync(join(root, config.publicTemplate), "utf8")).keys()) if (!isSecret(key)) values.set(key, "");
  }
  return {
    file,
    values,
    set: (k, v) => values.set(k, v),
    remove: (k) => values.delete(k),
    save: () =>
      writeDotenv(
        file,
        [`${rel(file)} — NON-SECRET settings of the ${env} environment (committed). Secrets belong in ${rel(secretFileOf(env))} (git-ignored).`, "Kept in step by `node scripts/env/app-env.mjs sync`. Variables already set in the environment win; empty = not set."],
        [...values.entries()],
        { secret: false },
      ),
  };
}

// --------------------------------------------------------------------------------------------------------------- sync
function syncEnvironment(env, check) {
  const settings = openSettings(env);
  const secretFile = secretFileOf(env);
  const secrets = readDotenv(secretFile);
  if (!existsSync(secretFile) && config.environments[env].seedFrom && existsSync(join(root, config.environments[env].seedFrom))) {
    for (const [k, v] of readDotenv(join(root, config.environments[env].seedFrom))) if (isSecret(k)) secrets.set(k, v);
  }
  const problems = [];
  let settingsChanged = false;

  for (const [key, value] of settings.values) {
    if (!isSecret(key)) continue;
    if (value !== "") problems.push(`${rel(settings.file)}: ${key} is a secret — it belongs in ${rel(secretFile)}.`);
    if (check) continue;
    if (value !== "" && !secrets.get(key)) secrets.set(key, value);
    settings.remove(key);
    settingsChanged = true;
  }
  for (const [key, value] of [...secrets]) {
    if (isSecret(key) || isProcessKey(key)) continue;
    problems.push(`${rel(secretFile)}: ${key} is not a secret — it belongs in ${rel(settings.file)}.`);
    if (check) continue;
    if (value !== "") settings.set(key, value);
    secrets.delete(key);
    settingsChanged = true;
  }
  if (check) return problems;

  if (settingsChanged || !existsSync(settings.file)) settings.save();
  const ordered = [
    ...literalSecrets.map((k) => [k, secrets.get(k) ?? secrets.get([...secrets.keys()].find((x) => x.toLowerCase() === k.toLowerCase())) ?? ""]),
    ...[...secrets].filter(([k]) => !literalSecrets.some((l) => l.toLowerCase() === k.toLowerCase())),
  ];
  writeDotenv(
    secretFile,
    [
      `${rel(secretFile)} — SECRETS of the ${env} environment. Git-ignored: NEVER commit. Non-secret settings belong in ${rel(settings.file)}.`,
      "Kept in step by `node scripts/env/app-env.mjs sync`; CI/CD writes it from GitHub environment secrets (`from-secrets`).",
    ],
    ordered,
    { secret: true },
  );
  for (const p of problems) console.log(`moved: ${p}`);
  console.log(`${env}: ${rel(secretFile)} (${ordered.length} secret keys) · ${rel(settings.file)}`);
  return [];
}

// -------------------------------------------------------------------------------------------------------- from-secrets
function fromSecrets(env, out) {
  let secretsJson = {};
  try {
    secretsJson = JSON.parse(process.env.SECRETS_JSON || "{}");
  } catch {
    fail("SECRETS_JSON is not valid JSON (pass ${{ toJSON(secrets) }}).");
  }
  const byUpper = new Map(Object.entries(secretsJson).map(([k, v]) => [k.toUpperCase(), String(v)]));
  const entries = literalSecrets.map((k) => [k, byUpper.get(k.toUpperCase()) ?? ""]);
  for (const [k, v] of byUpper) {
    if (literalSecrets.some((l) => l.toUpperCase() === k)) continue;
    if (secretPatterns.some((r) => r.test(k))) {
      const pattern = (config.secrets ?? []).find((p) => p.includes("*") && toRegex(p).test(k));
      // GitHub upper-cases secret names; restore the documented casing of the wildcard's fixed prefix.
      const prefix = pattern.slice(0, pattern.indexOf("*"));
      entries.push([prefix + k.slice(prefix.length), v]);
    }
  }
  entries.push(["APP_ENVIRONMENT", env]);
  const file = out ? resolvePath(out) : secretFileOf(env);
  writeDotenv(file, [`Generated by CI/CD for ${env} from GitHub environment secrets. Do not edit on the host; change the secret instead.`], entries, { secret: true });
  const missing = entries.filter(([k, v]) => v === "" && k !== "APP_ENVIRONMENT").map(([k]) => k);
  console.log(`${env}: wrote ${entries.length - 1} secret keys to ${file}${missing.length ? ` (not set in GitHub: ${missing.join(", ")})` : ""}`);
}

// ----------------------------------------------------------------------------------------------------------------- run
function run(env, cmd) {
  if (!cmd.length) fail("run needs a command after --");
  // Set variables win; an empty one (e.g. an unset GitHub `vars.X` expression) counts as unset.
  const merged = { ...process.env, APP_ENVIRONMENT: env };
  const files = config.settingsFormat === "appsettings" ? [secretFileOf(env)] : [secretFileOf(env), settingsFileOf(env)];
  for (const file of files) for (const [k, v] of readDotenv(file)) if (v !== "" && !merged[k]) merged[k] = v;
  const result = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32", env: merged });
  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------------------------------------------- main
switch (command) {
  case "resolve":
    console.log(currentEnvironment(option("env")));
    break;
  case "sync": {
    const check = flag("check");
    const targets = option("env") ? [currentEnvironment(option("env"))] : envNames;
    const problems = targets.flatMap((env) => syncEnvironment(env, check));
    if (check) {
      for (const p of problems) console.error(`::error::${p}`);
      if (problems.length) fail(`${problems.length} setting(s) in the wrong file — run: node scripts/env/app-env.mjs sync`);
      console.log(`settings split OK (${targets.join(", ")})`);
    }
    break;
  }
  case "from-secrets":
    fromSecrets(currentEnvironment(option("env")), option("out"));
    break;
  case "run":
    run(currentEnvironment(option("env")), dashDash === -1 ? [] : argv.slice(dashDash + 1));
    break;
  default:
    console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 10).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
    process.exit(command ? 1 : 0);
}
