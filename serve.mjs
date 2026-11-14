// Launcher used by pm2.config.json: serves the static export (out/) with `serve` on HOST:PORT from the environment
// (pm2.config.json env_<environment>), because `serve` itself only takes the address as a command-line flag.
// Settings for the static server (trailing-slash folders, 404.html, cache and security headers) are in serve.json.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    `PORT must be a number between 1 and 65535 (got "${process.env.PORT ?? ""}").`,
  );
  process.exit(1);
}

// Shipped by the deploy package in runtime/; falls back to this checkout's devDependency for local runs.
const candidates = [
  path.join(root, "runtime", "node_modules", "serve", "build", "main.js"),
  path.join(root, "node_modules", "serve", "build", "main.js"),
];
const { existsSync } = await import("node:fs");
const entry = candidates.find((file) => existsSync(file));
if (!entry) {
  console.error(
    "`serve` is not installed (runtime/node_modules/serve or node_modules/serve).",
  );
  process.exit(1);
}

process.env.NO_UPDATE_NOTIFIER = "1";
process.argv = [
  process.argv[0],
  entry,
  path.join(root, "out"),
  "--listen",
  `tcp://${host}:${port}`,
  "--no-clipboard",
  "--no-port-switching",
  "--config",
  "../serve.json",
];
await import(pathToFileURL(entry).href);
