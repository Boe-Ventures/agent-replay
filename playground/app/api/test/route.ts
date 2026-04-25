import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    message: "Hello from agent-replay playground!",
    timestamp: new Date().toISOString(),
    status: "ok",
  });
}
