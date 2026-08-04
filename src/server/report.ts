import type { AgentReplayEvent, ReplayManifest } from "../core/types.js";

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
}

export function renderPortableReport(manifest: ReplayManifest, timeline: AgentReplayEvent[], summary: string): string {
  const data = escapeJson({ manifest, timeline, summary });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Replay — ${manifest.session.id}</title>
<style>
:root{color-scheme:dark;--bg:#090c12;--panel:#121722;--line:#263042;--muted:#94a3b8;--ink:#f8fafc;--accent:#7dd3fc;--bad:#fb7185;--good:#86efac}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;padding:18px 24px;background:#090c12ee;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:18px}header p{margin:4px 0 0;color:var(--muted)}
main{display:grid;grid-template-columns:minmax(280px,380px) 1fr;min-height:calc(100vh - 76px)}
aside{border-right:1px solid var(--line);padding:18px;overflow:auto}.summary{white-space:pre-wrap;color:#cbd5e1;font-family:ui-monospace,monospace;font-size:12px}
section{padding:18px;overflow:auto}.tools{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
input,select{background:var(--panel);border:1px solid var(--line);color:var(--ink);padding:9px 10px;border-radius:8px}
input{min-width:260px}.event{display:grid;grid-template-columns:78px 120px 1fr;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer}
.event:hover{background:var(--panel)}.time{color:var(--muted);font-variant-numeric:tabular-nums}.type{color:var(--accent)}
.event.error .type,.event.network-failed .type{color:var(--bad)}pre{white-space:pre-wrap;word-break:break-word}
dialog{width:min(900px,90vw);max-height:80vh;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px}
@media(max-width:760px){main{display:block}aside{border-right:0;border-bottom:1px solid var(--line)}.event{grid-template-columns:64px 90px 1fr}}
</style></head><body>
<header><h1>Agent Replay</h1><p id="meta"></p></header><main><aside><pre class="summary" id="summary"></pre></aside>
<section><div class="tools"><input id="search" placeholder="Search evidence"><select id="type"><option value="">All signals</option></select></div><div id="events"></div></section></main>
<dialog id="detail"><button onclick="this.parentElement.close()">Close</button><pre></pre></dialog>
<script id="agent-replay-data" type="application/json">${data}</script>
<script>
const data=JSON.parse(document.getElementById("agent-replay-data").textContent);
const events=data.timeline;const types=[...new Set(events.map(e=>e.type))].sort();
document.getElementById("meta").textContent=data.manifest.session.startedAt+" · "+data.manifest.session.privacyPreset+" privacy · "+events.length+" events";
document.getElementById("summary").textContent=data.summary;
const type=document.getElementById("type");types.forEach(t=>type.add(new Option(t,t)));
const describe=e=>{const d=e.data||{};if(e.type==="error")return d.message||"Error";if(e.type==="network")return (d.method||"GET")+" "+(d.url||"")+" → "+(d.status??"ERR");if(e.type==="route-change")return (d.from||"")+" → "+(d.to||"");if(e.type==="interaction")return (d.type||"interaction")+" "+(d.target||"");if(e.type==="marker")return d.label||"Marker";if(e.type==="console")return (d.args||[]).map(String).join(" ");return JSON.stringify(d).slice(0,220)};
function render(){const q=document.getElementById("search").value.toLowerCase();const selected=type.value;const root=document.getElementById("events");root.textContent="";
events.filter(e=>(!selected||e.type===selected)&&(!q||describe(e).toLowerCase().includes(q))).forEach(e=>{const row=document.createElement("div");const failed=e.type==="error"||(e.type==="network"&&(e.data.status==null||e.data.status>=400));row.className="event "+(failed?e.type==="error"?"error":"network-failed":"");row.innerHTML="<span class=time>"+(e.offsetMs/1000).toFixed(2)+"s</span><span class=type>"+e.type+"</span><span></span>";row.lastChild.textContent=describe(e);row.onclick=()=>{const dialog=document.getElementById("detail");dialog.querySelector("pre").textContent=JSON.stringify(e,null,2);dialog.showModal()};root.append(row)})}
document.getElementById("search").oninput=render;type.onchange=render;render();
</script></body></html>`;
}
