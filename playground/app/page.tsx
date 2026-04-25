"use client";

import { useState, useEffect } from "react";

interface Task {
  id: string;
  title: string;
  completed: boolean;
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch tasks on mount (small delay to ensure recording is active)
  useEffect(() => {
    const timer = setTimeout(() => fetchTasks(), 500);
    return () => clearTimeout(timer);
  }, []);

  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      // BUG 1 surfaces here: data.tasks is undefined because API returns "taks"
      // The spread into array will throw: "TypeError: data.tasks is not iterable"
      const taskList = [...data.tasks];
      setTasks(taskList);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
      setError("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      // BUG 2 surfaces here: response body is malformed JSON
      const data = await res.json();
      console.log("Task created:", data);
      setNewTitle("");
      fetchTasks();
    } catch (err) {
      console.error("Failed to add task:", err);
      setError("Failed to add task — server returned invalid response");
    }
  };

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev?.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteAll = async () => {
    try {
      // BUG 3: API doesn't handle DELETE — will return 405
      const res = await fetch("/api/tasks", { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Delete failed: ${res.status}`, text);
        setError(`Delete failed with status ${res.status}`);
        return;
      }
      setTasks([]);
    } catch (err) {
      console.error("Failed to delete tasks:", err);
      setError("Failed to delete tasks");
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 600 }}>
      <h1>📋 Task Manager</h1>
      <p style={{ color: "#666" }}>
        A simple task list app for testing{" "}
        <code>@boe-ventures/agent-replay</code> bug detection.
      </p>

      {/* Add task form */}
      <form onSubmit={addTask} style={{ display: "flex", gap: "0.5rem", margin: "1.5rem 0" }}>
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a new task..."
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            fontSize: "1rem",
            border: "1px solid #ccc",
            borderRadius: 6,
          }}
        />
        <button type="submit" style={buttonStyle("#2563eb")}>
          Add Task
        </button>
      </form>

      {/* Error banner */}
      {error && (
        <div style={{ padding: "0.75rem", background: "#fee2e2", color: "#dc2626", borderRadius: 6, marginBottom: "1rem" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <p>Loading tasks...</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {/* BUG 4: Missing key prop — React will warn in console */}
          {tasks?.map((task) => (
            <li
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem",
                borderBottom: "1px solid #eee",
              }}
            >
              <span
                style={{
                  flex: 1,
                  textDecoration: task.completed ? "line-through" : "none",
                  color: task.completed ? "#999" : "#111",
                }}
              >
                {task.title}
              </span>
              <button
                onClick={() => toggleTask(task.id)}
                style={buttonStyle(task.completed ? "#6b7280" : "#16a34a")}
              >
                {task.completed ? "Undo" : "Complete"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Delete all */}
      <div style={{ marginTop: "1.5rem" }}>
        <button onClick={deleteAll} style={buttonStyle("#dc2626")}>
          🗑️ Delete All Tasks
        </button>
      </div>

      {/* BUG 4: Missing key prop — React will warn in console */}
      <div style={{ marginTop: "2rem" }}>
        <h3>Recent Activity</h3>
        <ul style={{ padding: 0, listStyle: "none" }}>
          {["Page loaded", "Session started", "Recording active"].map((item) => (
            <li style={{ padding: "0.25rem 0", color: "#666", fontSize: "0.875rem" }}>
              • {item}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: "2rem", padding: "1rem", background: "#f5f5f5", borderRadius: 8, fontSize: "0.875rem" }}>
        <strong>Debug:</strong> Check <code>.agent-replay/latest/</code> for session recordings after interacting.
      </div>
    </main>
  );
}

function buttonStyle(bg: string): React.CSSProperties {
  return {
    padding: "0.5rem 1rem",
    fontSize: "0.875rem",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    color: "white",
    background: bg,
    fontWeight: 600,
  };
}
