// @ts-check

/**
 * Entry point of the packaged application.
 *
 * Its only job is to tell the plugin system where the bundled VS Code builtin
 * extensions live before Theia's generated `electron-main` starts. Nothing else
 * in the application knows that path: in development the plugins sit at the
 * workspace root, and in a packaged build electron-builder copies them outside
 * the asar archive.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Where the bundled builtins are.
 *
 * When packaged with asar, `__dirname` is inside `app.asar/scripts`, but
 * `extraResources` puts the plugins at `<resources>/app/plugins`, outside the
 * archive — the plugin host reads them as real files on disk, which an asar
 * archive does not provide.
 */
const bundledPluginsDir = __dirname.includes(".asar")
  ? path.join(process.resourcesPath, "app", "plugins")
  : path.resolve(__dirname, "..", "..", "..", "plugins");

/**
 * Copies the bundled builtins into a writable directory, once per version.
 *
 * Only used on AppImage, whose mount point is read-only while the plugin
 * deployer needs to write into the plugin directory. The copy is keyed by
 * application version so an upgrade replaces stale plugins instead of running
 * the previous ones.
 *
 * @param {string} source read-only directory holding the bundled plugins
 * @param {string} target writable directory to copy them into
 * @param {string} version current application version
 * @returns {string} the directory to actually use — `target` when the copy
 *   succeeded, `source` when it did not, so a failure degrades to a read-only
 *   plugin directory rather than to no plugins at all
 */
function copyBundledPlugins(source, target, version) {
  const stamp = path.join(target, ".version");
  try {
    if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === version) {
      return target;
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    fs.writeFileSync(stamp, version, "utf8");
    return target;
  } catch (error) {
    console.warn(`Could not copy bundled plugins to ${target}, using them read-only:`, error);
    return source;
  }
}

function pluginsDir() {
  if (!process.env.APPIMAGE) {
    return bundledPluginsDir;
  }
  // `THEIA_CONFIG_DIR` is honoured so a sandboxed or CI run can redirect this;
  // `~/.spexr` is SPEXR's own cache location for the copy, not Theia's config dir.
  const base = process.env.THEIA_CONFIG_DIR || path.join(os.homedir(), ".spexr");
  const { version } = require("../package.json");
  return copyBundledPlugins(bundledPluginsDir, path.join(base, "builtInPlugins"), version);
}

process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${pluginsDir()}`;

require("../src-gen/backend/electron-main.js");
