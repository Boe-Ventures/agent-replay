import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./evidence.css";

const github = "https://github.com/Boe-Ventures/agent-replay";
const npm = "https://www.npmjs.com/package/@boe-ventures/agent-replay";
const artifact = (name: string) => `${import.meta.env.BASE_URL}artifacts/${name}`;

function Terminal() {
  return <div className="terminal"><div className="dots"><i/><i/><i/></div><pre><span>$</span> agent-replay inspect --budget 4000<br/><br/><b>Failure at 18.4s</b><br/>click button “Place order”<br/>→ POST /api/checkout<br/>→ 500 in 342ms<br/>→ TypeError in CheckoutPage.tsx:47<br/><br/><em>Evidence fits the agent’s context. No model call.</em></pre></div>;
}

function Timeline() {
  const rows = [
    ["12.08s","interaction","Click button “Place order”"],
    ["12.11s","network","POST /api/checkout → 500"],
    ["12.46s","error","TypeError: cart.items is undefined"],
    ["12.51s","rrweb","DOM changed: error banner rendered"],
  ];
  return <div className="timeline"><div className="timeline-head"><span>Replay</span><span>Console</span><span>Network</span><span>Errors</span></div>{rows.map((row) => <div className={row[1]} key={row[0]}><time>{row[0]}</time><b>{row[1]}</b><span>{row[2]}</span></div>)}</div>;
}

function App() {
  return <><nav><a className="logo" href="#"><i/>Agent Replay</a><div><a href="#replay">Replay</a><a href="#privacy">Privacy</a><a href="#compare">Compare</a><a href={github}>GitHub</a></div></nav>
  <main>
    <section className="hero"><div className="eyebrow">Open source · local first · v0.3 public beta</div><h1>The browser remembers what your coding agent missed.</h1><p>Agent Replay is the local flight recorder for web development. Capture once. Debug with any agent. Replay for humans. Export as video.</p><div className="cta"><a className="primary" href="#install">Install Agent Replay</a><a href={github}>View source ↗</a></div><Terminal/></section>
    <section className="outputs"><article><small>01</small><h2>Agent evidence</h2><p>Compact, deterministic evidence for Codex, Claude Code, OpenHands, Continue, Ollama, and shell-capable local models.</p></article><article><small>02</small><h2>Human replay</h2><p>A synchronized local viewer for DOM history, console, network, errors, routes, interactions, WebSockets, and markers.</p></article><article><small>03</small><h2>Video</h2><p>Best-effort replay export, annotated Playwright receipts, and faithful Chrome tab capture for polished demos.</p></article></section>
    <section className="evidence" id="replay"><div className="evidence-copy"><div className="eyebrow">Recorded by Agent Replay</div><h2>One broken flow. Every useful point of view.</h2><p>This is not a mockup. The video, viewer frame, portable capsule, and fix receipt below were generated from the deterministic BugBoard fixture during the v0.3 release run.</p><div className="artifact-links"><a className="primary" href={artifact("bugboard-broken.areplay")}>Download sample capsule</a><a href={artifact("fix-receipt.html")}>Open fix receipt ↗</a><a href={artifact("local-model-inspection.md")}>Read local-model evidence ↗</a></div></div><div className="media-card"><video controls playsInline preload="metadata" poster={artifact("viewer.jpg")}><source src={artifact("agent-replay-demo.mp4")} type="video/mp4"/></video><div className="media-caption"><span><i/> Live viewer + replay export</span><span>H.264 · 1920×1080</span></div></div></section>
    <section className="feature"><div><div className="eyebrow">Correlated, not merely collected</div><h2>From click to cause in one timeline.</h2><p>Every event has stable identity and ordering. Agent Replay connects the interaction, request, response, error, route, and resulting DOM change—then deep-links the exact moment.</p></div><Timeline/></section>
    <section className="receipt" id="compare"><div className="receipt-card"><span>FIX RECEIPT</span><h3>Checkout error resolved</h3><div><b>Before</b><em>1 uncaught error · POST /checkout 500</em></div><div className="after"><b>After</b><em>0 errors · POST /checkout 200</em></div><footer>Aligned by marker “place-order” · final route completed</footer></div><div><div className="eyebrow">Proof, not vibes</div><h2>Compare the broken run with the fix.</h2><p><code>agent-replay compare before after</code> emits JSON, Markdown, and HTML with resolved and new errors, network changes, routes, timing, and final-state differences. Add video when a human needs the receipt.</p></div></section>
    <section className="comparison"><div className="eyebrow">Works with the tools you already use</div><h2>Native browser tools inspect now. Agent Replay preserves before.</h2><div className="table"><div><b>Tool</b><b>Best at</b><b>Agent Replay’s role</b></div><div><span>Codex / Claude</span><span>Live control and inspection</span><span>Passive pre-attachment history</span></div><div><span>Playwright</span><span>Repeatable automation and traces</span><span>Cross-agent evidence and fix receipts</span></div><div><span>Chrome DevTools</span><span>Deep live diagnostics</span><span>Portable, bounded artifact</span></div><div><span>Local models</span><span>Private/offline reasoning</span><span>Pre-correlated context they can afford</span></div></div></section>
    <section className="privacy" id="privacy"><div><div className="eyebrow">Safe by default</div><h2>Local evidence with a hard privacy boundary.</h2></div><ul><li><b>Loopback only.</b> The receiver binds to 127.0.0.1. Non-loopback operation requires an explicit token.</li><li><b>Secrets always redacted.</b> Auth, cookies, passwords, tokens, API keys, sessions, and configured fields are removed regardless of preset.</li><li><b>Bounded capture.</b> Rolling history, body limits, batch limits, file quotas, disk quotas, and automatic retention.</li><li><b>No account or cloud.</b> Flat files and portable capsules stay under your control.</li></ul></section>
    <section className="install" id="install"><div><div className="eyebrow">Two explicit lines for React</div><h2>Start remembering.</h2><pre><span>npm install</span> @boe-ventures/agent-replay{"\n"}<span>npx</span> agent-replay dev</pre><p>Add <code>&lt;AgentReplayProvider /&gt;</code> to React, or install the release extension for any localhost app. Next.js uses one provider and one catch-all development route.</p></div><div className="commands"><code>agent-replay view</code><code>agent-replay inspect --budget 4000</code><code>agent-replay pack</code><code>agent-replay export --format mp4</code><code>agent-replay compare before after</code></div></section>
    <section className="limits"><h2>Honest limitations</h2><p>rrweb reconstructs the DOM; it does not record pixels. Canvas, WebGL, maps, video, and cross-origin embeds may be incomplete. Agent Replay warns when it sees them and recommends true Chrome tab capture. Tab audio is opt-in beta. v0.3 excludes microphone narration, cloud storage, production analytics, React internals, OTLP correlation, and a new browser controller.</p><p>The <a href={github + "/blob/main/docs/ORIGINAL_VISION.md"}>original April 2026 vision</a> is preserved verbatim with context about what native agent browsers later superseded.</p></section>
  </main><footer className="site-footer"><div><a className="logo" href="#"><i/>Agent Replay</a><p>Built in the open by Boe Ventures.</p></div><div><a href={github}>GitHub</a><a href={npm}>npm</a><a href="https://boe.ventures">boe.ventures</a></div></footer></>;
}

createRoot(document.getElementById("root")!).render(<App />);
