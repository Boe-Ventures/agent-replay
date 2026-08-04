"use client";

import { useState } from "react";
import { mark } from "@boe-ventures/agent-replay";

const issues = [
  { id: "BUG-142", title: "Checkout freezes after address change", status: "Investigating", owner: "Mara", priority: "P0" },
  { id: "BUG-137", title: "Invoice download has the wrong locale", status: "Ready", owner: "Ivo", priority: "P1" },
  { id: "BUG-129", title: "Avatar disappears on slow connections", status: "Fixed", owner: "Zoe", priority: "P2" },
];

export default function BugBoard() {
  const [result, setResult] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [running, setRunning] = useState(false);

  const runTriage = async (mode: "broken" | "fixed") => {
    setRunning(true); setResult(null);
    mark("triage-sync", { fixture: "BugBoard", mode });
    try {
      const response = await fetch("/api/triage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: "BUG-142", mode, apiKey: "fixture-secret-never-on-disk" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setResult({ kind: "ok", message: body.message });
      mark("triage-complete", { status: response.status });
    } catch (error) {
      console.error("[BugBoard] Triage sync failed", error);
      setResult({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  };

  return <main>
    <header className="top"><div><span className="mark">B</span><b>BugBoard</b><em>Replay fixture</em></div><span className="recording">● Agent Replay active</span></header>
    <section className="intro"><div><p>INCIDENT DESK / TUESDAY</p><h1>Find the break.<br/>Prove the fix.</h1><span>A deterministic project board for producing real Agent Replay evidence, replays, and fix receipts.</span></div>
      <div className="controls"><button disabled={running} className="broken" onClick={() => void runTriage("broken")}>Run broken triage</button><button disabled={running} onClick={() => void runTriage("fixed")}>Run clean triage</button></div></section>
    {result && <div className={"result " + result.kind}><b>{result.kind === "ok" ? "Triage completed" : "Captured failure"}</b><span>{result.message}</span></div>}
    <section className="board">{["Investigating","Ready","Fixed"].map((column) => <article key={column}><h2>{column}<small>{issues.filter((issue) => issue.status === column).length}</small></h2>{issues.filter((issue) => issue.status === column).map((issue) =>
      <div className="card" key={issue.id}><div><code>{issue.id}</code><strong>{issue.priority}</strong></div><h3>{issue.title}</h3><footer><i>{issue.owner.slice(0,1)}</i>{issue.owner}<span>•••</span></footer></div>)}</article>)}</section>
    <footer className="foot">Local fixture · no real customer data · matching marker: <code>triage-sync</code></footer>
  </main>;
}
