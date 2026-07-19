import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const publicManifestPath = path.join(root, "public", "manifest.json");
const distManifestPath = path.join(distDir, "manifest.json");
const packagePath = path.join(root, "package.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${path.relative(root, filePath)}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`${label} is empty: ${path.relative(root, filePath)}`);
  }
}

assertFile(packagePath, "package.json");
assertFile(publicManifestPath, "source manifest");
assertFile(distManifestPath, "built manifest");

const pkg = readJson(packagePath);
const sourceManifest = readJson(publicManifestPath);
const manifest = readJson(distManifestPath);

if (pkg.version !== sourceManifest.version || pkg.version !== manifest.version) {
  throw new Error(`version mismatch: package=${pkg.version}, public=${sourceManifest.version}, dist=${manifest.version}`);
}

if (manifest.manifest_version !== 3) {
  throw new Error(`expected Manifest V3, got ${manifest.manifest_version}`);
}

const scripts = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
].filter(Boolean);

for (const script of scripts) {
  assertFile(path.join(distDir, script), `manifest script ${script}`);
}

console.log(`Verified ${scripts.length} manifest script(s) for HeyNote ${pkg.version}.`);
