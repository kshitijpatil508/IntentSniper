import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["server", "public", "scripts"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const files = roots.flatMap((dir) => walk(path.join(root, dir)));
let failures = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log(`ok   ${path.relative(root, file)}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${path.relative(root, file)}`);
    console.log(String(error.stderr || error.message));
  }
}

console.log(failures === 0 ? `\n${files.length} files parsed cleanly` : `\n${failures} file(s) failed`);
process.exit(failures === 0 ? 0 : 1);
