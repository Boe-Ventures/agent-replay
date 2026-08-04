export async function POST(request: Request) {
  const body = await request.json() as { mode?: string; issueId?: string };
  await new Promise((resolve) => setTimeout(resolve, 260));
  if (body.mode === "broken") {
    return Response.json({
      error: "Cannot read properties of undefined (reading 'assignee')",
      code: "TRIAGE_OWNER_MISSING",
      debugToken: "fixture-secret-never-on-disk",
    }, { status: 500 });
  }
  return Response.json({
    ok: true,
    issueId: body.issueId,
    message: "BUG-142 assigned to Mara and moved to Ready",
  });
}
