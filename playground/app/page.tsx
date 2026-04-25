"use client";

export default function Home() {
  const handleLog = () => {
    console.log("User clicked the log button", { timestamp: Date.now() });
    console.warn("This is a warning from the playground");
  };

  const handleError = () => {
    throw new Error("Intentional test error from playground");
  };

  const handleFetch = async () => {
    const res = await fetch("/api/test");
    const data = await res.json();
    console.log("API response:", data);
  };

  const handleFetchError = async () => {
    try {
      const res = await fetch("/api/error");
      const data = await res.json();
      console.error("Error API response:", data);
    } catch (err) {
      console.error("Fetch failed:", err);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>🔴 Agent Replay Playground</h1>
      <p>Click buttons to generate events. Check <code>.agent-replay/</code> for output.</p>

      <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
        <button
          onClick={handleLog}
          style={buttonStyle("blue")}
        >
          📝 Log to Console
        </button>

        <button
          onClick={handleError}
          style={buttonStyle("red")}
        >
          💥 Throw Error
        </button>

        <button
          onClick={handleFetch}
          style={buttonStyle("green")}
        >
          ✅ Fetch /api/test (200)
        </button>

        <button
          onClick={handleFetchError}
          style={buttonStyle("orange")}
        >
          ❌ Fetch /api/error (500)
        </button>
      </div>

      <div style={{ marginTop: "2rem", padding: "1rem", background: "#f5f5f5", borderRadius: "8px" }}>
        <h3>How to test:</h3>
        <ol>
          <li>Start the sidecar: <code>npx agent-replay dev</code></li>
          <li>Start the playground: <code>cd playground && pnpm dev</code></li>
          <li>Click the buttons above</li>
          <li>Check: <code>npx agent-replay summary</code></li>
          <li>Or read: <code>cat .agent-replay/latest/errors.jsonl</code></li>
        </ol>
      </div>
    </main>
  );
}

function buttonStyle(color: string): React.CSSProperties {
  return {
    padding: "0.75rem 1.5rem",
    fontSize: "1rem",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    color: "white",
    background: color,
    fontWeight: 600,
  };
}
