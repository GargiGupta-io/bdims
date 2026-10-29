import { useEffect, useMemo, useState } from "react";
import { Badge, Card, Stat, inputClass } from "../components/ui.jsx";

// For evaluators: the real results of the latest build, read from
// dev-report.json. scripts/build-dev-report.js writes that file from the test
// run, the coverage run and deployments/; nothing on this page is typed in.
export default function DevPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("./dev-report.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setReport)
      .catch(() => setError("No report in this build. Run npm run report in the repo root, then rebuild the frontend."));
  }, []);

  if (error) return <Shell><p className="text-sm text-rose-700">{error}</p></Shell>;
  if (!report) return <Shell><p className="text-sm text-slate-500">Loading the latest results…</p></Shell>;

  const { tests, coverage, deployments, benchmark } = report;
  const commitUrl = `https://github.com/${report.repo}/commit/${report.commit}`;
  return (
    <Shell>
      <p className="text-sm text-slate-600">
        Generated {new Date(report.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} from commit{" "}
        <a className="font-mono text-teal-700 underline" href={commitUrl} target="_blank" rel="noreferrer">{report.commit?.slice(0, 7)}</a>
        {report.ciRun && (
          <>
            {" "}by{" "}
            <a className="text-teal-700 underline" href={report.ciRun} target="_blank" rel="noreferrer">this GitHub Actions run</a>
          </>
        )}
        .
      </p>

      {tests ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Test cases" value={tests.cases.length} />
          <Stat label="Passed" value={tests.passed} />
          <Stat label="Pending" value={tests.pending} hint={tests.pending ? "Not run yet; see below" : undefined} />
          <Stat label="Failed" value={tests.failed} />
        </div>
      ) : (
        <Missing what="Test results" />
      )}

      <Coverage coverage={coverage} />
      <Contracts deployments={deployments} />
      <Benchmark benchmark={benchmark} />
      {tests && <TestCases tests={tests} />}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Developer page</h1>
        <p className="mt-1 text-slate-600">Test cases, coverage, deployed contracts and benchmark results, rebuilt automatically on every change.</p>
      </div>
      {children}
    </div>
  );
}

function Missing({ what }) {
  return <p className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">{what}: not available in this build.</p>;
}

const pct = (v) => `${Number(v).toFixed(v === 100 ? 0 : 1)}%`;

function Coverage({ coverage }) {
  if (!coverage) return <Missing what="Coverage" />;
  return (
    <Card title="Coverage" subtitle="Share of each contract the tests execute. Target: 90% of statements.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">File</th>
              {["Statements", "Branches", "Functions", "Lines"].map((h) => <th key={h} className="py-2 pr-4 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {coverage.files.map((f) => (
              <tr key={f.file}>
                <td className="py-2 pr-4 font-mono text-xs">{f.file}</td>
                {[f.statements, f.branches, f.functions, f.lines].map((v, i) => (
                  <td key={i} className={`py-2 pr-4 text-right tabular-nums ${i === 0 && v < 90 ? "text-rose-700" : ""}`}>{pct(v)}</td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pr-4">All files</td>
              {[coverage.total.statements, coverage.total.branches, coverage.total.functions, coverage.total.lines].map((v, i) => (
                <td key={i} className="py-2 pr-4 text-right tabular-nums">{pct(v)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Contracts({ deployments }) {
  return (
    <Card title="Deployed contracts" subtitle={deployments.length ? "Each address links to its verified source code on Etherscan." : undefined}>
      {deployments.length === 0 ? (
        <p className="text-sm text-slate-500">Not deployed to Sepolia yet.</p>
      ) : (
        deployments.map((d) => (
          <dl key={d.chainId} className="space-y-2 text-sm">
            {Object.entries(d.contracts).map(([name, addr]) => (
              <div key={name} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="font-medium">{name}</dt>
                <dd>
                  <a className="break-all font-mono text-xs text-teal-700 underline" href={`https://sepolia.etherscan.io/address/${addr}#code`} target="_blank" rel="noreferrer">
                    {addr}
                  </a>
                </dd>
              </div>
            ))}
            <p className="pt-1 text-xs text-slate-500">Ethereum Sepolia · deployed {new Date(d.deployedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
          </dl>
        ))
      )}
    </Card>
  );
}

function Benchmark({ benchmark }) {
  return (
    <Card title="Performance benchmark" subtitle="Hyperledger Caliper on the real contracts, 12-second blocks like Sepolia.">
      {!benchmark ? (
        <p className="text-sm text-slate-500">Not run on the real contracts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                {["Round", "Succeeded", "Failed", "Throughput (TPS)", "Avg latency (s)"].map((h, i) => (
                  <th key={h} className={`py-2 pr-4 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {benchmark.rounds.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 pr-4 font-mono text-xs">{r.name}</td>
                  {[r.succ, r.fail, r.throughput, r.avgLatency].map((v, i) => <td key={i} className="py-2 pr-4 text-right tabular-nums">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const TONE = { passed: "green", pending: "amber", failed: "red" };

function TestCases({ tests }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map();
    for (const c of tests.cases) {
      if (status !== "all" && c.status !== status) continue;
      if (q && !`${c.suite} ${c.title}`.toLowerCase().includes(q)) continue;
      if (!map.has(c.suite)) map.set(c.suite, []);
      map.get(c.suite).push(c);
    }
    return [...map];
  }, [tests, query, status]);

  return (
    <Card title="Every test case" subtitle={`Grouped by contract and feature.${tests.pending ? " Pending cases are written but not run yet." : ""}`}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. recall" aria-label="Search test cases" />
        <select className={`${inputClass} sm:w-44`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by result">
          <option value="all">All results</option>
          <option value="passed">Passed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      {groups.length === 0 && <p className="text-sm text-slate-500">No test case matches.</p>}
      <div className="space-y-5">
        {groups.map(([suite, cases]) => (
          <section key={suite}>
            <h3 className="text-sm font-semibold text-slate-900">
              {suite} <span className="font-normal text-slate-500">· {cases.length}</span>
            </h3>
            <p className="font-mono text-xs text-slate-400">{cases[0].file}</p>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {cases.map((c) => (
                <li key={c.title} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    {c.title}
                    {c.error && <span className="mt-1 block font-mono text-xs text-rose-700">{c.error}</span>}
                  </span>
                  <Badge tone={TONE[c.status]}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
