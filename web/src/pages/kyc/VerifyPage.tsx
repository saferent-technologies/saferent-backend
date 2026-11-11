import { BadgeCheck, Building2, Camera, CheckCircle2, Circle, Clock, FileCheck2, Fingerprint, Phone, Send, ShieldCheck } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request, upload } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp } from "@/utils/format";

export type NameMatch = "EXACT" | "PARTIAL" | "MISMATCH";

export interface KycIdentity {
  id: string;
  provider: "SETU" | "MOCK";
  test: boolean;
  name: string | null;
  dob: string | null;
  gender: string | null;
  aadhaarLast4: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  hasPhoto: boolean;
  verifiedAt: string | null;
  nameMatch: NameMatch;
}

export interface KycProperty {
  id: string;
  code: string;
  title: string;
  city: string | null;
  publicationStatus: string;
  ownership: "VERIFIED" | "PENDING" | "REJECTED" | "MISSING";
  documents: Array<{ id: string; docType: string; status: string; rejectionReason: string | null }>;
}

interface MyKyc {
  stage: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "REJECTED";
  note: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  provider: "setu" | "mock" | "off";
  phoneVerified: boolean;
  identity: KycIdentity | null;
  selfie: boolean;
  properties: KycProperty[];
  canEdit: boolean;
  canSubmit: boolean;
}

export const OWNERSHIP_LABEL: Record<KycProperty["ownership"], { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  VERIFIED: { text: "Ownership verified", tone: "success" },
  PENDING: { text: "Proof under review", tone: "warning" },
  REJECTED: { text: "Proof rejected — upload again", tone: "danger" },
  MISSING: { text: "Ownership proof needed", tone: "neutral" },
};

export const MATCH_LABEL: Record<NameMatch, { text: string; tone: "success" | "warning" | "danger" }> = {
  EXACT: { text: "Name matches", tone: "success" },
  PARTIAL: { text: "Name partly matches", tone: "warning" },
  MISMATCH: { text: "Name doesn't match", tone: "danger" },
};

function Step({ n, done, title, icon, children }: { n: number; done: boolean; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="card flex gap-4 p-5">
      <div className="pt-0.5">{done ? <CheckCircle2 className="size-6 text-success" /> : <Circle className="size-6 text-muted" />}</div>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="flex items-center gap-2 font-semibold">{icon} {n}. {title}</h2>
        {children}
      </div>
    </section>
  );
}

/** /verify — owner verification checklist (DigiLocker → selfie → submit; ownership proof per property). */
export function VerifyPage() {
  const { profile } = useAuth();
  const { data, loading, error, reload } = useQuery(() => request<MyKyc>("/kyc/me"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selfieKey, setSelfieKey] = useState(0);
  const camera = useRef<HTMLInputElement>(null);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !profile) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ kind: "success", text: ok });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const startDigiLocker = () =>
    run("dl", async () => {
      const r = await request<{ url: string }>("/kyc/digilocker/start", { method: "POST", body: {} });
      window.location.assign(r.url);
    });

  const onSelfie = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMsg({ kind: "error", text: "The photo is larger than 5 MB." });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    void run("selfie", () => upload("/kyc/selfie", form), "Selfie saved.").then(() => setSelfieKey((k) => k + 1));
    if (camera.current) camera.current.value = "";
  };

  const id = data.identity;
  const stageBanner = {
    APPROVED: <Alert kind="success">You're a verified owner. Tenants see “Owner verified ✓” on your listings.</Alert>,
    SUBMITTED: <Alert kind="info">Submitted {formatTimestamp(data.submittedAt)}. SafeRent usually reviews within 1–2 working days.</Alert>,
    REJECTED: <Alert kind="error">Verification was sent back{data.note ? `: ${data.note}` : "."} Fix it below and submit again.</Alert>,
    IN_PROGRESS: null,
    NOT_STARTED: <Alert kind="info">Verify once so tenants can trust your listings. Properties go live only for verified owners.</Alert>,
  }[data.stage];

  return (
    <>
      <PageHeader
        title="Owner verification"
        description="Government ID through DigiLocker, a live selfie, and ownership proof for each property."
        actions={data.stage === "APPROVED" ? <Badge tone="success"><BadgeCheck className="size-4" />Owner verified</Badge> : data.stage === "SUBMITTED" ? <Badge tone="warning"><Clock className="size-4" />Under review</Badge> : undefined}
      />
      <div className="max-w-3xl space-y-4">
        {stageBanner}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        <Step n={1} done={data.phoneVerified} title="Phone number" icon={<Phone className="size-4" />}>
          <p className="text-sm text-muted">{data.phoneVerified ? "Verified with OTP." : "Verify your phone number in Security settings."}</p>
        </Step>

        <Step n={2} done={!!id} title="Government ID (DigiLocker)" icon={<Fingerprint className="size-4" />}>
          {id ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{id.name}</span>
                <Badge tone={MATCH_LABEL[id.nameMatch].tone}>{MATCH_LABEL[id.nameMatch].text}</Badge>
                {id.test && <Badge tone="warning">TEST — fake DigiLocker</Badge>}
              </div>
              <p className="text-muted">Aadhaar ••••{id.aadhaarLast4 ?? "????"} · {[id.city, id.state].filter(Boolean).join(", ")} · verified {formatTimestamp(id.verifiedAt)}</p>
              {id.nameMatch !== "EXACT" && <p className="text-xs text-muted">Your profile name is “{profile.fullName}”. If it's different from Aadhaar, update it in Profile so staff can match it.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">Sign in to DigiLocker with your Aadhaar OTP and allow SafeRent to read your Aadhaar. We keep only your name, date of birth, city and the last 4 digits — never the full Aadhaar number.</p>
          )}
          {data.canEdit && data.provider !== "off" && (
            <Button size="sm" variant={id ? "secondary" : "primary"} loading={busy === "dl"} onClick={() => void startDigiLocker()}>
              {id ? "Verify again" : "Verify with DigiLocker"}
            </Button>
          )}
          {data.provider === "off" && !id && <p className="text-sm text-warning">DigiLocker verification isn't switched on yet.</p>}
          {data.provider === "mock" && <p className="text-xs text-muted">Development mode: a fake DigiLocker is used (no real Aadhaar).</p>}
        </Step>

        <Step n={3} done={data.selfie} title="Live selfie" icon={<Camera className="size-4" />}>
          <p className="text-sm text-muted">Take a clear photo of your face in good light — staff compare it with your DigiLocker photo.</p>
          <div className="flex flex-wrap items-end gap-4">
            {data.selfie && <AuthImage key={selfieKey} path={`/kyc/files/${profile.id}/selfie`} alt="Your selfie" className="size-28 rounded-control" />}
            {data.canEdit && (
              <>
                <input ref={camera} type="file" hidden accept="image/jpeg,image/png,image/webp" capture="user" onChange={(e) => onSelfie(e.target.files)} />
                <Button size="sm" variant={data.selfie ? "secondary" : "primary"} leftIcon={<Camera className="size-4" />} loading={busy === "selfie"} onClick={() => camera.current?.click()}>
                  {data.selfie ? "Retake selfie" : "Take selfie"}
                </Button>
              </>
            )}
          </div>
        </Step>

        <Step n={4} done={data.stage === "SUBMITTED" || data.stage === "APPROVED"} title="Submit for review" icon={<Send className="size-4" />}>
          {data.stage === "APPROVED" ? (
            <p className="text-sm text-muted">Approved {formatTimestamp(data.reviewedAt)}.</p>
          ) : data.stage === "SUBMITTED" ? (
            <p className="text-sm text-muted">Waiting for SafeRent review.</p>
          ) : (
            <>
              <p className="text-sm text-muted">Finish steps 2 and 3, then send them to SafeRent.</p>
              <Button size="sm" leftIcon={<ShieldCheck className="size-4" />} disabled={!data.canSubmit} loading={busy === "submit"} onClick={() => void run("submit", () => request("/kyc/submit", { method: "POST", body: {} }), "Submitted for review.")}>
                Submit for verification
              </Button>
            </>
          )}
        </Step>

        <Step n={5} done={data.properties.length > 0 && data.properties.every((p) => p.ownership === "VERIFIED")} title="Ownership proof (each property)" icon={<FileCheck2 className="size-4" />}>
          <p className="text-sm text-muted">
            Upload a sale deed, property tax receipt or electricity bill in your name in the property's Documents tab. Not the owner?
            Upload the owner's authorisation letter with their ID as “Ownership proof”.
          </p>
          {data.properties.length === 0 ? (
            <p className="text-sm text-muted">No properties yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-control border border-line">
              {data.properties.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><Building2 className="size-4 shrink-0 text-muted" /><span className="truncate font-medium">{p.title}</span><span className="text-xs text-muted">{p.code}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge tone={OWNERSHIP_LABEL[p.ownership].tone}>{OWNERSHIP_LABEL[p.ownership].text}</Badge>
                    {p.ownership !== "VERIFIED" && <Link className="text-brand-dark underline" to={`/properties/${p.id}?tab=documents`}>Upload</Link>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Step>
      </div>
    </>
  );
}
