import { NextResponse } from "next/server";

export function ok<T>(payload: T, status = 200) {
  return NextResponse.json(payload, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
