// Turns the two Caliper HTML reports into results/summary.json for the
// developer page, and copies the reports next to it so they are committed.
// Runs at the end of `npm run bench`.

const fs = require("fs");
const path = require("path");

const CALIPER_ROOT = path.join(__dirname, "..");
const REPORTS = ["bdims-manufacturers.html", "bdims-pharmacies.html"];
const OUT = path.join(CALIPER_ROOT, "results");

const cells = (row) => [...row.matchAll(/<t[dh]>([^<]*)<\/t[dh]>/g)].map((m) => m[1].trim());

const rounds = [];
fs.mkdirSync(OUT, { recursive: true });
for (const file of REPORTS) {
  const html = fs.readFileSync(path.join(CALIPER_ROOT, "reports", file), "utf8");
  // The first table is "Summary of performance metrics", one row per round.
  const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
  const [header, ...rows] = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => cells(m[1]));
  const col = (name) => header.indexOf(name);
  for (const r of rows) {
    rounds.push({
      name: r[col("Name")],
      succ: Number(r[col("Succ")]),
      fail: Number(r[col("Fail")]),
      sendRate: Number(r[col("Send Rate (TPS)")]),
      throughput: Number(r[col("Throughput (TPS)")]),
      avgLatency: Number(r[col("Avg Latency (s)")]),
      maxLatency: Number(r[col("Max Latency (s)")]),
    });
  }
  fs.copyFileSync(path.join(CALIPER_ROOT, "reports", file), path.join(OUT, file));
}

const summary = {
  generatedAt: new Date().toISOString(),
  blockTimeMs: JSON.parse(fs.readFileSync(path.join(CALIPER_ROOT, "networks", "block-time.json"), "utf8")).blockTimeMs,
  rounds,
};
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`Wrote results/summary.json (${rounds.length} rounds) and copied the reports.`);
