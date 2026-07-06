import { NextRequest, NextResponse } from "next/server";

const INTERP_API_URL = process.env.INTERP_API_URL;
const INTERP_API_TOKEN = process.env.INTERP_API_TOKEN;
const RUN_TIMEOUT_MS = 120_000;

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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      {
        code: "REQUEST_FAILED",
        message: "Request body must be valid JSON."
      },
      { status: 400 }
    );
  }

  let response: Response;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    response = await fetch(`${INTERP_API_URL.replace(/\/$/, "")}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(INTERP_API_TOKEN ? { Authorization: `Bearer ${INTERP_API_TOKEN}` } : {})
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    return NextResponse.json(
      {
        code: "SERVICE_UNAVAILABLE",
        message: "The TransformerLens service is not reachable."
      },
      { status: 503 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  const normalizedPayload = payload?.detail && typeof payload.detail === "object" ? payload.detail : payload;

  return NextResponse.json(normalizedPayload, { status: response.status });
}
