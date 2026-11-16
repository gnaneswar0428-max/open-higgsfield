// electron-builder hook: copies the standalone Next.js server into the packaged
// app's resources folder. Done here rather than with extraResources because
// electron-builder filters out node_modules and dot-folders such as .next,
// both of which the server needs.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const source = path.join(context.packager.projectDir, "server");
  if (!fs.existsSync(path.join(source, "server.js"))) {
    throw new Error('desktop/server is missing. Run "npm run prepare-server" first.');
  }
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const target = path.join(resources, "server");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
};
