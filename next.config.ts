import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// @credigit/web-ui is installed from GitHub (see package.json), so builds work anywhere, including Netlify.
// For live library development you can link the sibling checkout instead:
//   npm install ../credigit-ser-web-component --no-save
// The link is a symlink outside this folder, so the build root must then include the parent folder,
// and React must resolve to this app's single copy (the library's own dev install would load a second React).
const libraryPath = path.join(__dirname, "node_modules", "@credigit", "web-ui");
const libraryLinked = fs.existsSync(libraryPath) && fs.lstatSync(libraryPath).isSymbolicLink();
const workspaceRoot = path.join(__dirname, "..");
const singleton = (name: string) => path.join(__dirname, "node_modules", name);

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@credigit/web-ui"],
  ...(libraryLinked
    ? {
        outputFileTracingRoot: workspaceRoot,
        turbopack: {
          root: workspaceRoot,
          resolveAlias: {
            react: "./node_modules/react",
            "react-dom": "./node_modules/react-dom",
            "lucide-react": "./node_modules/lucide-react",
          },
        },
        webpack: (config: { resolve: { alias: Record<string, string> } }) => {
          config.resolve.alias = {
            ...config.resolve.alias,
            react: singleton("react"),
            "react-dom": singleton("react-dom"),
            "lucide-react": singleton("lucide-react"),
          };
          return config;
        },
      }
    : {}),
};

export default nextConfig;
