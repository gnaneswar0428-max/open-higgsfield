// Builds the Next.js app as a standalone server and copies it into
// desktop/server, which electron-builder ships as an extra resource.
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = join(desktopDir, "..");
const outDir = join(desktopDir, "server");
const standalone = join(rootDir, ".next", "standalone");

const run = (cmd) => execSync(cmd, { cwd: rootDir, stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "standalone" } });

if (!existsSync(join(rootDir, "node_modules"))) run("pnpm install --frozen-lockfile");
rmSync(standalone, { recursive: true, force: true });
run("pnpm build");

if (!existsSync(join(standalone, "server.js"))) {
  throw new Error("Standalone build missing .next/standalone/server.js");
}

// Copies a tree with every symlink replaced by the real files it points to.
function copyResolved(src, dest) {
  const real = realpathSync(src);
  if (statSync(real).isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) copyResolved(join(src, name), join(dest, name));
  } else {
    copyFileSync(real, dest);
  }
}

// Lists package dirs ("next", "@swc/helpers") inside a node_modules folder.
function packagesIn(nodeModules) {
  if (!existsSync(nodeModules)) return [];
  return readdirSync(nodeModules)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) =>
      name.startsWith("@")
        ? readdirSync(join(nodeModules, name)).map((sub) => `${name}/${sub}`)
        : [name],
    );
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(standalone)) {
  if (name !== "node_modules") copyResolved(join(standalone, name), join(outDir, name));
}

// pnpm's standalone node_modules is a tree of symlinks into .pnpm, where each
// package finds its dependencies as siblings. Symlinks do not survive
// packaging, so rebuild it as a flat npm-style node_modules: direct
// dependencies first, then every traced package from the .pnpm store.
const srcModules = join(standalone, "node_modules");
const destModules = join(outDir, "node_modules");
const placed = new Set();
const place = (name, from) => {
  if (placed.has(name)) return;
  placed.add(name);
  copyResolved(from, join(destModules, name));
};
for (const name of packagesIn(srcModules)) place(name, join(srcModules, name));
const store = join(srcModules, ".pnpm");
if (existsSync(store)) {
  for (const entry of readdirSync(store)) {
    const inner = join(store, entry, "node_modules");
    for (const name of packagesIn(inner)) place(name, join(inner, name));
  }
}
cpSync(join(rootDir, ".next", "static"), join(outDir, ".next", "static"), { recursive: true });
cpSync(join(rootDir, "public"), join(outDir, "public"), { recursive: true });
// Never ship local secrets inside the app bundle.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  rmSync(join(outDir, name), { force: true });
}
cpSync(join(rootDir, "public", "icon-512.png"), join(desktopDir, "build", "icon.png"));

console.log(`Standalone server ready in ${outDir}`);
