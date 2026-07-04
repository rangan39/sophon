import { NextRequest, NextResponse } from "next/server";

const INTERP_API_URL = process.env.INTERP_API_URL;
const INTERP_API_TOKEN = process.env.INTERP_API_TOKEN;

export async function POST(request: NextRequest) {
  if (!INTERP_API_URL) {
    return NextResponse.json(
      {
        code: "SERVICE_UNAVAILABLE",
        message: "Set INTERP_API_URL to enable live TransformerLens runs."
      },
      { status: 503 }
    );
  }

  const body = await request.json();
  let response: Response;

  try {
    response = await fetch(`${INTERP_API_URL.replace(/\/$/, "")}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(INTERP_API_TOKEN ? { Authorization: `Bearer ${INTERP_API_TOKEN}` } : {})
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      {
        code: "SERVICE_UNAVAILABLE",
        message: "The TransformerLens service is not reachable."
      },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  const normalizedPayload = payload?.detail && typeof payload.detail === "object" ? payload.detail : payload;

  return NextResponse.json(normalizedPayload, { status: response.status });
}
