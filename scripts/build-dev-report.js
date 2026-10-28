// Collects everything the developer page shows into one file,
// frontend/public/dev-report.json. Run `npm run report` rather than this
// directly: it produces the test and coverage results this reads first.
//
// Nothing here is typed in by hand. Tests and coverage come from the runs
// just made, contract addresses from deployments/, and the benchmark from
// caliper/results/ (written after the final Caliper run). Anything missing
// is reported as missing, never filled in.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const read = (p) => (fs.existsSync(path.join(root, p)) ? JSON.parse(fs.readFileSync(path.join(root, p), "utf8")) : null);

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function tests() {
  const raw = read("reports/tests.json");
  if (!raw) return null;
  const status = new Map();
  for (const t of raw.passes) status.set(t.fullTitle, "passed");
  for (const t of raw.pending) status.set(t.fullTitle, "pending");
  for (const t of raw.failures) status.set(t.fullTitle, "failed");
  const cases = raw.tests.map((t) => ({
    file: path.relative(root, t.file || ""),
    suite: t.fullTitle.slice(0, t.fullTitle.length - t.title.length).trim(),
    title: t.title,
    status: status.get(t.fullTitle) ?? "failed",
    ms: t.duration ?? null,
    error: t.err?.message ?? null,
  }));
  return {
    passed: raw.stats.passes,
    pending: raw.stats.pending,
    failed: raw.stats.failures,
    durationMs: raw.stats.duration,
    cases,
  };
}

function coverage() {
  const raw = read("coverage/coverage-summary.json");
  if (!raw) return null;
  const pct = (m) => ({ statements: m.statements.pct, branches: m.branches.pct, functions: m.functions.pct, lines: m.lines.pct });
  const files = Object.entries(raw)
    .filter(([file]) => file !== "total" && !file.includes("/interfaces/"))
    .map(([file, m]) => ({ file: path.relative(root, file), ...pct(m) }));
  return { total: pct(raw.total), files };
}

function deployments() {
  const dir = path.join(root, "deployments");
  return fs
    .readdirSync(dir)
    .filter((f) => f === "sepolia.json")
    .map((f) => {
      const m = read(`deployments/${f}`);
      return { network: m.network, chainId: m.chainId, deployedAt: m.deployedAt, contracts: m.contracts };
    });
}

const commit = process.env.GITHUB_SHA || git("rev-parse HEAD");
const repo = process.env.GITHUB_REPOSITORY || "GargiGupta-io/bdims";
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  repo,
  ciRun: process.env.GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  tests: tests(),
  coverage: coverage(),
  deployments: deployments(),
  benchmark: read("caliper/results/summary.json"),
};

const out = path.join(root, "frontend", "public", "dev-report.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
const t = report.tests;
console.log(`Developer report: ${t ? `${t.passed} passed, ${t.pending} pending, ${t.failed} failed` : "no test results"}`);
console.log(`Written to ${path.relative(process.cwd(), out)}`);
