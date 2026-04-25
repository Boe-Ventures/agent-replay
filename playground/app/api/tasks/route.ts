import { NextResponse } from "next/server";

// In-memory task store (resets on server restart)
const tasks: { id: string; title: string; completed: boolean }[] = [
  { id: "1", title: "Set up agent-replay", completed: true },
  { id: "2", title: "Write E2E tests", completed: false },
  { id: "3", title: "Deploy to production", completed: false },
];

// BUG 1: Returns "taks" instead of "tasks" — client expects `data.tasks` but gets `data.taks`
export async function GET() {
  return NextResponse.json({
    taks: tasks, // <-- typo: should be "tasks"
    count: tasks.length,
  });
}

// BUG 2: Returns malformed JSON — missing closing brace
export async function POST(request: Request) {
  const body = await request.json();
  const newTask = {
    id: String(Date.now()),
    title: body.title || "Untitled task",
    completed: false,
  };
  tasks.push(newTask);

  // Return malformed JSON string instead of proper response
  return new Response(
    `{"success": true, "task": {"id": "${newTask.id}", "title": "${newTask.title}"`,
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// BUG 3: No DELETE handler — calling DELETE will return 405 Method Not Allowed
// (intentionally omitted)
