import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = [
  "docs/superpowers/specs",
  "docs/superpowers/plans",
];

const STALE_PATTERNS = [
  /Block live order mutations in v1/i,
  /place\s*\+\s*confirm\/reply\s*\+\s*cancel\s*\+\s*modify are rejected server-side/i,
  /403 if account is not paper/i,
  /Server-side live block/i,
  /live_trading_blocked/i,
  /paper-only order mutations/i,
  /place\/confirm\/cancel\/modify are paper-only/i,
  /Live-account order mutations \(blocked\)/i,
  /live account order mutations are blocked/i,
  /mutation controls are disabled/i,
  /403-on-live/i,
  /No live account can place, confirm, cancel, or modify orders/i,
];

const SKIP_DIRS = new Set(["archive", "node_modules", ".git"]);

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

const findings = [];
for (const relativeDir of TARGET_DIRS) {
  const dir = path.join(ROOT, relativeDir);
  for (const file of await listMarkdownFiles(dir)) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const matched = STALE_PATTERNS.find((pattern) => pattern.test(line));
      if (matched) {
        findings.push({
          file: path.relative(ROOT, file),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }
}

if (findings.length) {
  console.error("Trading Safety policy docs are stale. Live mutations are allowed and must be policy-backed with real-money confirmation.");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.text}`);
  }
  process.exit(1);
}

console.log("Trading Safety policy docs are aligned.");
