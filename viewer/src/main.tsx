import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Replayer } from "@rrweb/replay";
import "@rrweb/replay/dist/style.css";
import "./style.css";

type Metadata = {
  id: string; startedAt: string; durationMs?: number; url?: string;
  privacyPreset?: string; pinned?: boolean; pinReason?: string;
};
type Session = { id: string; metadata: Metadata | null; schemaVersion: number };
type Event = { id: string; type: string; sequence: number; timestamp: number; offsetMs: number; data: Record<string, unknown> };

const api = "/api/v1";

function describe(event: Event): string {
  const data = event.data ?? {};
  if (event.type === "error") return String(data.message ?? "Error");
  if (event.type === "network") return `${data.method ?? "GET"} ${data.url ?? ""} → ${data.status ?? "ERR"}`;
  if (event.type === "route-change") return `${data.from ?? ""} → ${data.to ?? ""}`;
  if (event.type === "interaction") return `${data.type ?? "interaction"} ${data.target ?? ""}`;
  if (event.type === "marker") return String(data.label ?? "Marker");
  if (event.type === "console") return (data.args as unknown[] ?? []).map(String).join(" ");
  return event.type;
}

function App() {
  const params = new URLSearchParams(location.search);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState(params.get("session") ?? "");
  const [events, setEvents] = useState<Event[]>([]);
  const [query, setQuery] = useState("");
  const [signal, setSignal] = useState("");
  const [selected, setSelected] = useState<Event | null>(null);
  const [clipIn, setClipIn] = useState<number | null>(null);
  const [clipOut, setClipOut] = useState<number | null>(null);
  const replayRoot = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);

  useEffect(() => {
    fetch(api + "/sessions").then((response) => response.json()).then((value) => {
      setSessions(value.sessions);
      if (!sessionId && value.sessions[0]) setSessionId(value.sessions[0].id);
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    history.replaceState(null, "", "?session=" + sessionId);
    fetch(`${api}/sessions/${sessionId}/timeline`).then((response) => response.json()).then((value) => setEvents(value.events));
  }, [sessionId]);

  useEffect(() => {
    const source = new EventSource(api + "/watch");
    source.onmessage = (message) => {
      const incoming = JSON.parse(message.data) as Event[];
      setEvents((current) => [...current, ...incoming.filter((event) => event.sessionId === sessionId)]);
    };
    return () => source.close();
  }, [sessionId]);

  useEffect(() => {
    if (!replayRoot.current) return;
    const rrweb = events.filter((event) => event.type === "rrweb").map((event) => event.data);
    replayRoot.current.textContent = "";
    replayer.current = rrweb.length > 1
      ? new Replayer(rrweb as never[], { root: replayRoot.current, liveMode: false, skipInactive: params.get("skipIdle") === "1", showWarning: false })
      : null;
    const startAt = Number(params.get("t") ?? 0);
    if (replayer.current && startAt > 0) replayer.current.play(startAt);
    return () => { replayer.current?.pause(); replayer.current = null; };
  }, [events]);

  const current = sessions.find((session) => session.id === sessionId);
  const signals = useMemo(() => [...new Set(events.map((event) => event.type))].sort(), [events]);
  const visible = useMemo(() => events.filter((event) =>
    (!signal || event.type === signal) && (!query || describe(event).toLowerCase().includes(query.toLowerCase())),
  ), [events, signal, query]);
  const seek = (event: Event) => {
    setSelected(event);
    replayer.current?.play(event.offsetMs);
    history.replaceState(null, "", `?session=${sessionId}&t=${event.offsetMs}`);
  };

  return <div className="app">
    <aside>
      <div className="brand"><span className="pulse" />Agent Replay <small>local</small></div>
      <p className="tagline">The browser remembers what your coding agent missed.</p>
      <div className="session-list">{sessions.map((session) =>
        <button className={session.id === sessionId ? "active" : ""} key={session.id} onClick={() => setSessionId(session.id)}>
          <strong>{new Date(session.metadata?.startedAt ?? 0).toLocaleString()}</strong>
          <span>{session.metadata?.url || session.id}</span>
          <em>{session.metadata?.pinned ? "Pinned incident" : session.schemaVersion ? "Capsule v1" : "Legacy"}</em>
        </button>,
      )}</div>
    </aside>
    <main>
      <header>
        <div><h1>{current?.metadata?.url || "Session"}</h1><p>{current?.metadata?.startedAt} · <span className="privacy">{current?.metadata?.privacyPreset ?? "unknown"} privacy</span></p></div>
        <div className="actions"><button onClick={() => replayer.current?.play()}>Play</button><button onClick={() => replayer.current?.pause()}>Pause</button></div>
      </header>
      <div className="replay-shell"><div className="replay" ref={replayRoot}>{events.length ? "Preparing replay…" : "Waiting for evidence…"}</div></div>
      <div className="clipbar"><span>Clip</span><button onClick={() => setClipIn(selected?.offsetMs ?? 0)}>In {clipIn == null ? "—" : (clipIn / 1000).toFixed(1) + "s"}</button><button onClick={() => setClipOut(selected?.offsetMs ?? events.at(-1)?.offsetMs ?? 0)}>Out {clipOut == null ? "—" : (clipOut / 1000).toFixed(1) + "s"}</button></div>
      <section className="timeline">
        <div className="filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search console, routes, requests, errors…" />
          <select value={signal} onChange={(event) => setSignal(event.target.value)}><option value="">All lanes</option>{signals.map((type) => <option key={type}>{type}</option>)}</select></div>
        <div className="lanes">{signals.filter((type) => type !== "rrweb").map((type) => <span key={type}>{type}<b>{events.filter((event) => event.type === type).length}</b></span>)}</div>
        <div className="event-list">{visible.filter((event) => event.type !== "rrweb").map((event) =>
          <button key={event.id} className={"event " + event.type + (selected?.id === event.id ? " selected" : "")} onClick={() => seek(event)}>
            <time>{(event.offsetMs / 1000).toFixed(2)}s</time><span>{event.type}</span><strong>{describe(event)}</strong>
          </button>,
        )}</div>
      </section>
    </main>
    {selected && <div className="detail"><button onClick={() => setSelected(null)}>×</button><h2>{selected.type} at {(selected.offsetMs / 1000).toFixed(2)}s</h2><pre>{JSON.stringify(selected, null, 2)}</pre></div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
