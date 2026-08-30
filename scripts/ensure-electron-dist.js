#!/usr/bin/env node
// Repairs node_modules/electron/dist when Electron's own installer leaves it
// empty. See https://github.com/sondalab-ai/spexr-ide/issues/22: the archive
// downloads and verifies, but extraction silently produces a single licence
// file, so `theia build` dies reading dist/version. Runs as postinstall.
// Run by hand: node scripts/ensure-electron-dist.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON_DIR = path.join(ROOT, "node_modules", "electron");
const DIST = path.join(ELECTRON_DIR, "dist");

/** Path inside dist that electron/index.js resolves the binary through. */
function binaryPath() {
  if (process.platform === "darwin") return "Electron.app/Contents/MacOS/Electron";
  if (process.platform === "win32") return "electron.exe";
  return "electron";
}

/** Root of Electron's download cache, honouring ELECTRON_CACHE. */
function cacheRoot() {
  if (process.env.ELECTRON_CACHE) return process.env.ELECTRON_CACHE;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "electron");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), "electron", "Cache");
  }
  return path.join(os.homedir(), ".cache", "electron");
}

/** The cache stores each artifact under a hash directory, so search one level down. */
function findCachedZip(version) {
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const root = cacheRoot();
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root)) {
    const candidate = path.join(root, entry, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function isInstalled(version) {
  try {
    const installed = fs.readFileSync(path.join(DIST, "version"), "utf8").trim().replace(/^v/, "");
    if (installed !== version) return false;
    return fs.readFileSync(path.join(ELECTRON_DIR, "path.txt"), "utf8").trim() === binaryPath();
  } catch {
    return false;
  }
}

function extract(zip) {
  // ditto, not unzip: it preserves the symlinks inside the Electron.app bundle.
  if (process.platform === "darwin") {
    execFileSync("ditto", ["-x", "-k", zip, DIST], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-q", "-o", zip, "-d", DIST], { stdio: "inherit" });
  }
}

function main() {
  if (!fs.existsSync(ELECTRON_DIR)) return;
  const { version } = JSON.parse(
    fs.readFileSync(path.join(ELECTRON_DIR, "package.json"), "utf8"),
  );
  if (isInstalled(version)) return;

  const zip = findCachedZip(version);
  if (!zip) {
    console.warn(
      `[ensure-electron-dist] electron ${version} is not unpacked and no cached archive was found ` +
        `under ${cacheRoot()}. Run "node node_modules/electron/install.js" to download it, then re-run this script.`,
    );
    return;
  }

  console.log(`[ensure-electron-dist] re-extracting electron ${version} from ${zip}`);
  fs.rmSync(DIST, { recursive: true, force: true });
  extract(zip);
  fs.writeFileSync(path.join(ELECTRON_DIR, "path.txt"), binaryPath());

  if (!isInstalled(version)) {
    console.error("[ensure-electron-dist] extraction did not produce a usable dist directory");
    process.exitCode = 1;
  }
}

main();
