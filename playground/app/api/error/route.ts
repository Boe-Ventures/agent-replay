import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Intentional 500 error for testing",
      timestamp: new Date().toISOString(),
    },
    { status: 500 }
  );
}
