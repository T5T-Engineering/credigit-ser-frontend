// Post-build fix for Next.js 16 static export + route groups.
// The export writes segment-prefetch payloads as nested folders, e.g.
//   out/dashboard/__next.!KGFwcCk/dashboard/__PAGE__.txt
// but the client requests the dot-joined name:
//   /dashboard/__next.!KGFwcCk.dashboard.__PAGE__.txt
// Without this, every page logs 404s on static hosts (Netlify) and prefetching is wasted.
// Copies each nested payload to the flat name the client expects. Safe to run repeatedly.
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = join(process.cwd(), "out");
if (!existsSync(OUT)) {
  console.error("flatten-segment-prefetch: out/ not found — run next build first.");
  process.exit(1);
}

let copied = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next.")) {
      flatten(dir, full);
    } else {
      walk(full);
    }
  }
}
function flatten(routeDir, segmentRoot) {
  const stack = [segmentRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        stack.push(full);
      } else if (name.endsWith(".txt")) {
        const rel = relative(routeDir, full).split(sep).join(".");
        const target = join(routeDir, rel);
        if (!existsSync(target)) {
          copyFileSync(full, target);
          copied++;
        }
      }
    }
  }
}
walk(OUT);
console.log(`flatten-segment-prefetch: wrote ${copied} prefetch file(s).`);
