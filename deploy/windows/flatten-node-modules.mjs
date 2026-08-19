// Flatten a pnpm-style node_modules (symlink forest into .pnpm/) into a
// plain physical tree. Reasons: symlinks do not survive zip -> Windows
// extraction, and removing the ".pnpm/<hash>/node_modules/" segment cuts
// ~75 chars off the longest path (MAX_PATH headroom).
//
// Usage: node flatten-node-modules.mjs <node_modules_dir>

import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
  console.error("Usage: node flatten-node-modules.mjs <node_modules_dir>");
  process.exit(2);
}

const pnpmDir = path.join(root, ".pnpm");

function readVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Collect every concrete package dir found under .pnpm/<entry>/node_modules. */
function collectPackages() {
  const found = new Map(); // name -> { dir, version }
  if (!fs.existsSync(pnpmDir)) return found;
  for (const entry of fs.readdirSync(pnpmDir)) {
    const nm = path.join(pnpmDir, entry, "node_modules");
    if (!fs.existsSync(nm)) continue;
    for (const name of fs.readdirSync(nm)) {
      const full = path.join(nm, name);
      const stat = fs.lstatSync(full);
      if (name.startsWith("@") && stat.isDirectory() && !stat.isSymbolicLink()) {
        for (const sub of fs.readdirSync(full)) {
          register(found, `${name}/${sub}`, path.join(full, sub));
        }
      } else {
        register(found, name, full);
      }
    }
  }
  return found;
}

function register(found, name, dir) {
  const stat = fs.lstatSync(dir);
  // Symlinked entries inside .pnpm point at other .pnpm packages we will
  // visit anyway; only real directories are canonical sources.
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) return;
  const version = readVersion(dir);
  const existing = found.get(name);
  if (existing) {
    if (existing.version !== version) {
      console.error(
        `Version conflict for "${name}": ${existing.version} (${existing.dir}) vs ${version} (${dir}). ` +
          `A flat layout cannot hold both — resolve the duplicate before packaging.`,
      );
      process.exit(1);
    }
    return;
  }
  found.set(name, { dir, version });
}

const packages = collectPackages();

// Replace every top-level entry (symlink or dir) with the flattened copy.
for (const entry of fs.readdirSync(root)) {
  if (entry === ".pnpm" || entry === ".prisma") continue;
  const full = path.join(root, entry);
  if (fs.lstatSync(full).isSymbolicLink()) fs.rmSync(full, { force: true });
  else if (entry.startsWith("@")) {
    for (const sub of fs.readdirSync(full)) {
      const subFull = path.join(full, sub);
      if (fs.lstatSync(subFull).isSymbolicLink()) fs.rmSync(subFull, { force: true });
    }
  }
}

let copied = 0;
for (const [name, { dir }] of packages) {
  const dest = path.join(root, name);
  if (fs.existsSync(dest)) continue; // already physical (e.g. copied earlier)
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(dir, dest, { recursive: true, dereference: true });
  copied++;
}

// .prisma (generated client + engines) lives inside .pnpm's @prisma/client
// realm; hoist it to the flat root where @prisma/client's runtime expects it.
if (!fs.existsSync(path.join(root, ".prisma"))) {
  const candidates = [];
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      const p = path.join(pnpmDir, entry, "node_modules", ".prisma");
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  if (candidates.length > 0) {
    fs.cpSync(candidates[0], path.join(root, ".prisma"), { recursive: true, dereference: true });
    copied++;
  }
}

if (fs.existsSync(pnpmDir)) fs.rmSync(pnpmDir, { recursive: true, force: true });

// Final safety: no symlinks may remain anywhere.
let symlinks = 0;
(function scan(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      symlinks++;
      console.error(`Residual symlink: ${full}`);
    } else if (stat.isDirectory()) scan(full);
  }
})(root);

if (symlinks > 0) process.exit(1);
console.log(`Flattened ${copied} packages into ${root}; no symlinks remain.`);
