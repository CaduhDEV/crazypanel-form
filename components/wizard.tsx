"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Stage = "name" | "email" | "email_code" | "phone" | "phone_code" | "done";

interface Session {
  id: string;
  token: string;
}

interface ApiError {
  code: string;
  message: string;
  retryAfter: number | null;
}

const STORAGE_KEY = "crazypanel-form:session";
const RESEND_SECONDS = 60;

async function call<T = Record<string, unknown>>(step: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/step/${step}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; code?: string; message?: string; retryAfter?: number | null }) | null;
  if (!res.ok || !data?.ok) {
    const err: ApiError = {
      code: data?.code ?? "unexpected",
      message: data?.message ?? "Algo deu errado. Tente de novo.",
      retryAfter: data?.retryAfter ?? null,
    };
    throw err;
  }
  return data;
}

const isApiError = (e: unknown): e is ApiError => !!e && typeof e === "object" && "message" in e && "code" in e;

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** (43) 98424-4218 */
function maskPhone(digits: string) {
  const d = digits.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const STEPS: { key: string; label: string; stages: Stage[] }[] = [
  { key: "name", label: "Nome", stages: ["name"] },
  { key: "email", label: "E-mail", stages: ["email", "email_code"] },
  { key: "phone", label: "WhatsApp", stages: ["phone", "phone_code"] },
];

export function Wizard() {
  const [stage, setStage] = useState<Stage>("name");
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<{ status: string; company: string | null } | null>(null);
  // Tamanho do código do e-mail (o Supabase deste projeto usa 8); o do WhatsApp é sempre 6.
  const [emailCodeLength, setEmailCodeLength] = useState(8);
  const resumed = useRef(false);
  // Até saber se há uma sessão para retomar, mostra o esqueleto (evita pular de etapa na frente da pessoa).
  const [ready, setReady] = useState(false);

  // Relógio para os contadores (reenvio e bloqueio).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Recarregou a página no meio: retoma de onde parou.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const s = loadSession();
    if (!s) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- só depois de ler o sessionStorage no cliente
      setReady(true);
      return;
    }
    call<{ stage: Stage; name: string; email: string; phone: string | null; lockedUntil: string | null; codeLength?: number }>("status", { ...s })
      .then((r) => {
        setSession(s);
        setName(r.name);
        setEmail(r.email);
        if (r.phone) setPhone(r.phone.replace(/^55/, ""));
        if (r.lockedUntil) setLockedUntil(Date.parse(r.lockedUntil));
        if (r.codeLength) setEmailCodeLength(r.codeLength);
        setStage(r.stage === "done" ? "name" : r.stage);
        if (r.stage === "done") saveSession(null);
      })
      .catch(() => saveSession(null))
      .finally(() => setReady(true));
  }, []);

  const fail = useCallback((e: unknown) => {
    const err = isApiError(e) ? e : { code: "unexpected", message: "Algo deu errado. Tente de novo.", retryAfter: null };
    setError(err.message);
    if (err.code === "locked" && err.retryAfter) setLockedUntil(Date.now() + err.retryAfter * 1000);
    if (err.code === "cooldown" && err.retryAfter) setResendAt(Date.now() + err.retryAfter * 1000);
    if (err.code === "invalid_session") {
      saveSession(null);
      setSession(null);
      setStage("email");
    }
  }, []);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  const locked = lockedUntil !== null && lockedUntil > now;
  const resendIn = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0;

  // ---------------------------------------------------------------------------
  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Informe seu nome.");
    setError(null);
    setStage("email");
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await call<{ id: string; token: string; resendInSeconds?: number; codeLength?: number }>("start", { name: name.trim(), email: email.trim() });
      if (r.codeLength) setEmailCodeLength(r.codeLength);
      const s = { id: r.id, token: r.token };
      saveSession(s);
      setSession(s);
      setCode("");
      setResendAt(Date.now() + (r.resendInSeconds ?? RESEND_SECONDS) * 1000);
      setStage("email_code");
    });
  };

  const confirmEmail = (value: string) =>
    run(async () => {
      await call("email/confirm", { ...session!, code: value });
      setCode("");
      setStage("phone");
    });

  const resendEmail = () =>
    run(async () => {
      await call("email/resend", { ...session! });
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
    });

  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await call("phone/start", { ...session!, phone });
      setCode("");
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setStage("phone_code");
    });
  };

  const confirmPhone = (value: string) =>
    run(async () => {
      const r = await call<{ status: string; company: string | null }>("phone/confirm", { ...session!, code: value });
      saveSession(null);
      setResult({ status: r.status, company: r.company });
      setStage("done");
    });

  const resendPhone = () =>
    run(async () => {
      await call("phone/resend", { ...session! });
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
    });

  // ---------------------------------------------------------------------------
  const activeStep = STEPS.findIndex((s) => s.stages.includes(stage));

  return (
    <div className="relative z-10 w-full max-w-md">
      <div className="mb-6 flex items-center justify-center">
        <span className="flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-4 py-1.5 text-sm font-extrabold tracking-tight backdrop-blur">
          <svg viewBox="0 0 296 296" className="size-4 text-violet" aria-hidden>
            <path
              d="M95.5657 295.294L81.3239 266.381L83.6986 253.77L216.273 203.763L29.6997 163.986V129.706L37.5589 119.97L219.3 63.0427L0.647095 42.1422V9.22756L8.53698 0L289.531 33.3945L295.941 44.3661V73.7989L91.0102 142.341L266.719 178.411L273.376 188.488V215.648L95.5657 295.294Z"
              fill="currentColor"
            />
          </svg>
          DataCrazy
          <span className="h-3.5 w-px bg-line-strong" aria-hidden />
          <span className="font-medium text-muted">Comunidade</span>
        </span>
      </div>

      <div className="rounded-3xl border border-line bg-panel p-6 shadow-[0_24px_80px_-20px_rgba(76,29,149,0.55)] backdrop-blur-xl sm:p-8">
        {!ready ? (
          <WizardSkeleton />
        ) : (
          <>
        {stage !== "done" && (
          <ol className="mb-7 flex items-center gap-2" aria-label="Etapas">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex flex-1 flex-col gap-1.5">
                <span className={`h-1 rounded-full transition-colors ${i <= activeStep ? "bg-violet" : "bg-line-strong"}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${i === activeStep ? "text-text" : "text-muted"}`}>{s.label}</span>
              </li>
            ))}
          </ol>
        )}

        <div key={stage} className="step-enter">
          {stage === "name" && (
            <form onSubmit={submitName} className="flex flex-col gap-5">
              <Heading title="Qual o seu nome?" text="Vamos confirmar seus dados para liberar sua entrada na comunidade oficial no WhatsApp." />
              <Field label="Nome completo">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Como você se chama?"
                  className={inputClass}
                  maxLength={120}
                />
              </Field>
              <ErrorText error={error} />
              <Submit busy={busy}>Continuar</Submit>
            </form>
          )}

          {stage === "email" && (
            <form onSubmit={submitEmail} className="flex flex-col gap-5">
              <Heading title="Qual o seu e-mail?" text="Use o mesmo e-mail com que você acessa o CRM DataCrazy. Vamos mandar um código para confirmar." />
              <Field label="E-mail">
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="voce@empresa.com.br"
                  className={inputClass}
                  maxLength={200}
                />
              </Field>
              <ErrorText error={error} />
              <Submit busy={busy} disabled={locked}>
                Enviar código
              </Submit>
              <Back onClick={() => setStage("name")} />
            </form>
          )}

          {stage === "email_code" && (
            <div className="flex flex-col gap-5">
              <Heading title="Confira seu e-mail" text={`Digite o código de ${emailCodeLength} números que enviamos para ${email}.`} />
              <CodeInput value={code} onChange={setCode} onComplete={confirmEmail} disabled={busy || locked} length={emailCodeLength} />
              <ErrorText error={error} />
              <Resend seconds={resendIn} busy={busy} locked={locked} onClick={resendEmail} />
              <Back label="Trocar e-mail" onClick={() => setStage("email")} />
            </div>
          )}

          {stage === "phone" && (
            <form onSubmit={submitPhone} className="flex flex-col gap-5">
              <Heading title="Qual o seu WhatsApp?" text="Vamos mandar um código pelo WhatsApp para confirmar que o número é seu." />
              <Field label="WhatsApp">
                <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-white/[0.04] focus-within:border-violet">
                  <span className="flex items-center gap-1.5 border-r border-line px-3 text-sm text-muted">🇧🇷 +55</span>
                  <input
                    autoFocus
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={maskPhone(phone)}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    placeholder="(11) 98765-4321"
                    className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base text-text outline-none placeholder:text-muted/60"
                  />
                </div>
              </Field>
              <ErrorText error={error} />
              <Submit busy={busy} disabled={locked || phone.length < 10}>
                Enviar código pelo WhatsApp
              </Submit>
            </form>
          )}

          {stage === "phone_code" && (
            <div className="flex flex-col gap-5">
              <Heading title="Confira seu WhatsApp" text={`Digite o código de 6 números que enviamos para +55 ${maskPhone(phone)}.`} />
              <CodeInput value={code} onChange={setCode} onComplete={confirmPhone} disabled={busy || locked} />
              <ErrorText error={error} />
              <Resend seconds={resendIn} busy={busy} locked={locked} onClick={resendPhone} />
              <Back label="Trocar número" onClick={() => setStage("phone")} />
            </div>
          )}

          {stage === "done" && result && <Done name={name} result={result} />}
        </div>
          </>
        )}

        {locked && stage !== "done" && (
          <p className="mt-5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-center text-sm text-danger">
            Muitas tentativas. Tente de novo em {Math.max(1, Math.ceil((lockedUntil! - now) / 60000))} min.
          </p>
        )}
      </div>

      <p className="mt-5 text-center text-xs text-muted">Seus dados são usados só para liberar sua entrada na comunidade.</p>
    </div>
  );
}

// =============================================================================
const inputClass =
  "w-full rounded-xl border border-line bg-white/[0.04] px-4 py-3 text-base text-text outline-none transition-colors placeholder:text-muted/60 focus:border-violet";

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

function Submit({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-violet to-violet-strong px-4 py-3 text-base font-bold text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.8)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
      {children}
    </button>
  );
}

function Back({ onClick, label = "Voltar" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="self-center text-sm text-muted underline-offset-4 hover:text-text hover:underline">
      {label}
    </button>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}

function Resend({ seconds, busy, locked, onClick }: { seconds: number; busy: boolean; locked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={seconds > 0 || busy || locked}
      className="self-center text-sm font-semibold text-violet disabled:cursor-not-allowed disabled:font-normal disabled:text-muted"
    >
      {seconds > 0 ? `Reenviar código em ${seconds} s` : "Reenviar código"}
    </button>
  );
}

/** Uma caixa por dígito; aceita colar o código inteiro e confere sozinho ao completar. */
function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled: boolean;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (!disabled) refs.current[Math.min(value.length, length - 1)]?.focus();
  }, [disabled, value.length, length]);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete(clean);
  };

  return (
    <div className="flex justify-between gap-1.5 sm:gap-2" onPaste={(e) => (e.preventDefault(), set(e.clipboardData.getData("text")))}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Dígito ${i + 1}`}
          maxLength={length}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return;
            // Autopreenchimento do celular joga o código inteiro numa caixa.
            set(typed.length > 1 ? typed : (value.slice(0, i) + typed).slice(0, length));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              onChange(value.slice(0, Math.max(0, d ? i : i - 1)));
            }
          }}
          className="h-14 w-full min-w-0 rounded-xl max-[380px]:h-12 border border-line bg-white/[0.04] text-center font-mono text-2xl font-medium outline-none transition-colors focus:border-violet disabled:opacity-60"
        />
      ))}
    </div>
  );
}

function Done({ name, result }: { name: string; result: { status: string; company: string | null } }) {
  const first = name.trim().split(/\s+/)[0];
  const already = result.status === "joined";
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-ok/15 text-3xl text-ok" aria-hidden>
        ✓
      </span>
      <h1 className="text-2xl font-extrabold tracking-tight">{already ? `Tudo certo, ${first}!` : `Pedido recebido, ${first}!`}</h1>
      <p className="text-sm leading-relaxed text-muted">
        {already
          ? "Seus dados foram confirmados. Você já faz parte da comunidade no WhatsApp."
          : "E-mail e WhatsApp confirmados. Nossa equipe vai analisar e liberar sua entrada na comunidade pelo WhatsApp."}
      </p>
      {result.company && (
        <p className="rounded-xl border border-line bg-white/[0.03] px-4 py-2 text-sm">
          Empresa: <span className="font-semibold">{result.company}</span>
        </p>
      )}
    </div>
  );
}

/** Esqueleto do cartão enquanto confere se há uma sessão para retomar. */
function WizardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Carregando">
      <div className="mb-2 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-1 flex-col gap-1.5">
            <span className="skeleton h-1 rounded-full" />
            <span className="skeleton h-2.5 w-12 rounded" />
          </div>
        ))}
      </div>
      <span className="skeleton h-7 w-3/5 rounded-lg" />
      <span className="flex flex-col gap-2">
        <span className="skeleton h-3.5 w-full rounded" />
        <span className="skeleton h-3.5 w-4/5 rounded" />
      </span>
      <span className="skeleton mt-1 h-12 w-full rounded-xl" />
      <span className="skeleton h-12 w-full rounded-xl" />
    </div>
  );
}
