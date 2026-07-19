import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function isolateClassicContentScripts(): Plugin {
  const entryNames = new Set(["domain-claim", "domain-entry", "search-bridge"]);

  return {
    name: "isolate-classic-content-scripts",
    generateBundle(_options, bundle) {
      Object.values(bundle).forEach((output) => {
        if (output.type !== "chunk" || !entryNames.has(output.name)) return;
        if (output.imports.length || output.dynamicImports.length || output.exports.length) {
          this.error(`${output.fileName} 必须是可独立执行、没有 import/export 的经典脚本`);
        }

        // Chrome runs manifest content scripts and scripting.executeScript files
        // in the same isolated global. Keep each Rollup entry in its own lexical
        // scope so minified top-level names can never collide across injections.
        output.code = `(() => {\n${output.code}\n})();\n`;
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), isolateClassicContentScripts()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    copyPublicDir: true,
    rollupOptions: {
      input: {
        "domain-claim": fromRoot("./src/domain-claim.ts"),
        "domain-entry": fromRoot("./src/domain-entry.tsx"),
        "search-bridge": fromRoot("./src/search-bridge.ts"),
        background: fromRoot("./src/background.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "domain-claim") return "domain-claim.js";
          if (chunk.name === "domain-entry") return "domain-entry.js";
          if (chunk.name === "search-bridge") return "search-bridge.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) => asset.name?.endsWith(".css")
          ? "domain-entry.css"
          : "assets/[name]-[hash][extname]"
      }
    }
  }
});
