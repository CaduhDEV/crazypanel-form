import { NextResponse, type NextRequest } from "next/server";

// Repassa cada etapa do formulário para o CrazyPanel (/api/verify/*) com a chave
// compartilhada. O navegador só conversa com este site; a chave e a URL do
// painel nunca vão para o cliente.

export const dynamic = "force-dynamic";

const STEPS = new Set(["start", "status", "email/resend", "email/confirm", "phone/start", "phone/resend", "phone/confirm"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const step = (await params).path.join("/");
  if (!STEPS.has(step)) return NextResponse.json({ ok: false, code: "not_found", message: "Etapa desconhecida." }, { status: 404 });

  const panel = process.env.PANEL_API_URL?.replace(/\/+$/, "");
  const key = process.env.FORM_API_KEY;
  if (!panel || !key) {
    return NextResponse.json({ ok: false, code: "not_configured", message: "Formulário em manutenção. Tente mais tarde." }, { status: 503 });
  }

  const body = await request.text();
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;

  try {
    const res = await fetch(`${panel}/api/verify/${step}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-form-key": key,
        ...(ip ? { "x-client-ip": ip } : {}),
        "x-client-user-agent": request.headers.get("user-agent") ?? "",
      },
      body: body || "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json().catch(() => ({ ok: false, code: "bad_response", message: "Resposta inesperada. Tente de novo." }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, code: "unreachable", message: "Não conseguimos falar com o servidor agora. Tente de novo em instantes." }, { status: 502 });
  }
}
