import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCount = () => {
    const next = count + 1;
    console.log(`[Counter] clicked → ${next}`);
    setCount(next);
  };

  const handleError = () => {
    console.error("[App] About to throw a runtime error");
    throw new Error("Intentional runtime error from Vite playground");
  };

  const handleFetchOk = async () => {
    setFetchResult(null);
    setError(null);
    try {
      // Fetch a local JSON file served by Vite
      const res = await fetch("/mock-api/tasks.json");
      const data: unknown = await res.json();
      console.log("[Fetch OK] response:", data);
      setFetchResult(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("[Fetch OK] failed:", err);
      setError(String(err));
    }
  };

  const handleFetch404 = async () => {
    setFetchResult(null);
    setError(null);
    try {
      const res = await fetch("/api/nonexistent");
      console.warn(`[Fetch 404] status: ${res.status}`);
      if (!res.ok) {
        setError(`Request failed with status ${res.status}`);
        return;
      }
      const data: unknown = await res.json();
      setFetchResult(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("[Fetch 404] failed:", err);
      setError(String(err));
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
      <h1>⚡ Agent Replay — Vite Playground</h1>
      <p style={{ color: "#666" }}>
        Minimal test bed for <code>@boe-ventures/agent-replay</code> without
        Next.js. Each button exercises a different capture path.
      </p>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
        {/* Counter */}
        <button onClick={handleCount} style={btn("#2563eb")}>
          🔢 Counter: {count}
        </button>

        {/* Runtime error */}
        <button onClick={handleError} style={btn("#dc2626")}>
          💥 Throw Runtime Error
        </button>

        {/* Successful fetch */}
        <button onClick={handleFetchOk} style={btn("#16a34a")}>
          ✅ Fetch Mock API (200)
        </button>

        {/* 404 fetch */}
        <button onClick={handleFetch404} style={btn("#d97706")}>
          🚫 Fetch Non-existent (404)
        </button>
      </section>

      {/* Result / error display */}
      {error && (
        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fee2e2", color: "#dc2626", borderRadius: 6 }}>
          ⚠️ {error}
        </div>
      )}
      {fetchResult && (
        <pre style={{ marginTop: "1rem", padding: "0.75rem", background: "#f0fdf4", borderRadius: 6, fontSize: "0.85rem", overflow: "auto" }}>
          {fetchResult}
        </pre>
      )}

      <div style={{ marginTop: "2rem", padding: "1rem", background: "#f5f5f5", borderRadius: 8, fontSize: "0.875rem" }}>
        <strong>Debug:</strong> Run{" "}
        <code>npx agent-replay dev --port 3700</code> alongside this dev
        server, then check <code>.agent-replay/latest/</code> for captured
        events.
      </div>
    </main>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    padding: "0.6rem 1.2rem",
    fontSize: "1rem",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    color: "white",
    background: bg,
    fontWeight: 600,
    textAlign: "left",
  };
}
