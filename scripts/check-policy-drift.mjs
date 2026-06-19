import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const BASE_REF = process.env.POLICY_DRIFT_BASE || process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) || "dev";

const ACTIVE_DOC_DIRS = [
  "docs/architecture",
  "docs/superpowers/specs",
  "docs/superpowers/plans",
];

const ACTIVE_DOC_FILES = [
  "AGENTS.md",
  "PROJECT_PLAN.md",
  "docs/testing.md",
  "docs/ibkr-pacing.md",
];

const POLICY_DOC_PATTERNS = [
  /^AGENTS\.md$/,
  /^PROJECT_PLAN\.md$/,
  /^docs\/architecture\/.*\.md$/,
  /^docs\/testing\.md$/,
  /^docs\/superpowers\/specs\/.*\.md$/,
  /^docs\/superpowers\/plans\/.*\.md$/,
  /^docs\/ibkr-pacing\.md$/,
];

const SKILL_PATTERNS = [
  /^\.agents\/skills\/[^/]+\/SKILL\.md$/,
];

const POLICY_SOURCE_PATTERNS = [
  /^backend\/.*\.(py|toml|md)$/,
  /^src\/.*\.(ts|tsx|md)$/,
  /^src-tauri\/.*\.(rs|toml|json)$/,
  /^package\.json$/,
  /^AGENTS\.md$/,
  /^\.agents\/skills\/[^/]+\/SKILL\.md$/,
];

const POLICY_KEYWORDS = /\b(policy|guard|allowed|blocked|required|must|never|safety|confirmation|permission|auth|live|paper|cloud|local|conid|typed error|rate[- ]?limit|pacing|autonomous|IBKR|Ollama|sidecar|merge to dev)\b/i;

const KNOWN_STALE_PATTERNS = [
  {
    name: "trading-safety-live-mutations",
    message: "Live mutations are allowed and must be policy-backed with real-money confirmation.",
    patterns: [
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
    ],
  },
  {
    name: "cloud-key-sqlite-storage",
    message: "Cloud keys use OS keychain only; SQLite stores opaque api_key_ref values.",
    patterns: [
      /api_key_encrypted/i,
      /API keys stay local:\s*encrypted at rest/i,
    ],
  },
];

const SKIP_DIRS = new Set(["archive", "node_modules", ".git"]);

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function resolveBaseRef() {
  const mergeBase = tryGit(["merge-base", "HEAD", BASE_REF]);
  if (mergeBase) return mergeBase;
  const originMergeBase = tryGit(["merge-base", "HEAD", `origin/${BASE_REF}`]);
  if (originMergeBase) return originMergeBase;
  return "";
}

function splitLines(text) {
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(items)].sort();
}

async function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
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

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

function diffFor(base, file) {
  const diffs = [];
  if (base) diffs.push(tryGit(["diff", "--unified=0", `${base}...HEAD`, "--", file]));
  diffs.push(tryGit(["diff", "--unified=0", "--", file]));
  diffs.push(tryGit(["diff", "--cached", "--unified=0", "--", file]));
  return diffs.filter(Boolean).join("\n");
}

function changedLines(diff) {
  return diff
    .split(/\r?\n/)
    .filter((line) => /^[+-]/.test(line) && !line.startsWith("+++") && !line.startsWith("---"))
    .map((line) => line.slice(1));
}

function changedFiles(base) {
  return unique([
    ...splitLines(base ? tryGit(["diff", "--name-only", `${base}...HEAD`]) : ""),
    ...splitLines(tryGit(["diff", "--name-only"])),
    ...splitLines(tryGit(["diff", "--cached", "--name-only"])),
    ...splitLines(tryGit(["ls-files", "--others", "--exclude-standard"])),
  ]);
}

function changedPolicySources(base, files) {
  return files.filter((file) => {
    if (!matchesAny(file, POLICY_SOURCE_PATTERNS)) return false;
    const lines = changedLines(diffFor(base, file));
    return lines.some((line) => POLICY_KEYWORDS.test(line));
  });
}

async function staleDocFindings() {
  const findings = [];
  const files = [];
  for (const relativeDir of ACTIVE_DOC_DIRS) {
    const dir = path.join(ROOT, relativeDir);
    files.push(...await listMarkdownFiles(dir));
  }
  files.push(...ACTIVE_DOC_FILES.filter(existsSync).map((file) => path.join(ROOT, file)));
  for (const file of unique(files)) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const family of KNOWN_STALE_PATTERNS) {
        const matched = family.patterns.find((pattern) => pattern.test(line));
        if (matched) {
          findings.push({
            family,
            file: path.relative(ROOT, file),
            line: index + 1,
            text: line.trim(),
          });
        }
      }
    });
  }
  return findings;
}

const base = resolveBaseRef();
const files = changedFiles(base);
const policySources = changedPolicySources(base, files);
const changedPolicyDocs = files.filter((file) => matchesAny(file, POLICY_DOC_PATTERNS));
const changedSkills = files.filter((file) => matchesAny(file, SKILL_PATTERNS));
const staleFindings = await staleDocFindings();

const failures = [];
if (policySources.length && !changedPolicyDocs.length && !changedSkills.length) {
  failures.push("Policy-bearing code/config changed, but no active policy docs or skills changed.");
}

if (staleFindings.length) {
  const families = unique(staleFindings.map((finding) => `${finding.family.name}: ${finding.family.message}`));
  failures.push(`Known stale policy language found:\n${families.map((item) => `  - ${item}`).join("\n")}`);
}

if (failures.length) {
  console.error("Policy drift check failed.");
  if (base) console.error(`Base: ${base}`);
  for (const failure of failures) console.error(`\n${failure}`);
  if (policySources.length) {
    console.error("\nPolicy-bearing changed files:");
    for (const file of policySources) console.error(`  - ${file}`);
  }
  if (staleFindings.length) {
    console.error("\nStale policy lines:");
    for (const finding of staleFindings) {
      console.error(`  - ${finding.file}:${finding.line}: ${finding.text}`);
    }
  }
  process.exit(1);
}

console.log("Policy drift check passed.");
if (base) console.log(`Base: ${base}`);
if (policySources.length) {
  console.log("Policy-bearing changes:");
  for (const file of policySources) console.log(`  - ${file}`);
}
