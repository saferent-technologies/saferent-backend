import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";

/* Landlord → smart rent reminder schedule. */

interface S { enabled: boolean; beforeDays: number[]; overdueDays: number[]; smartEarly: boolean }
const BEFORE = [5, 3, 2, 1];
const AFTER = [1, 3, 7, 15];

export function RentReminderSettings() {
  const { data, reload } = useQuery(() => request<{ settings: S; sendingHours: string }>("/rent/reminder-settings"), []);
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => setS(data?.settings ?? null), [data]);
  if (!s) return null;
  const toggle = (k: "beforeDays" | "overdueDays", d: number) => setS({ ...s, [k]: s[k].includes(d) ? s[k].filter((x) => x !== d) : [...s[k], d] });
  const save = async () => {
    setMsg(null);
    try {
      await request("/rent/reminder-settings", { method: "PUT", body: s });
      await reload();
      setMsg({ kind: "success", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  };
  return (
    <section className="card mb-4 space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-semibold">Rent reminders to tenants</p><p className="text-xs text-muted">Sent in the app between {data?.sendingHours}. "Rent due today" is always sent.</p></div>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> On</label>
      </div>
      {s.enabled && (
        <>
          <div className="flex flex-wrap items-center gap-3">Before due date:{BEFORE.map((d) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={s.beforeDays.includes(d)} onChange={() => toggle("beforeDays", d)} /> {d} day{d > 1 ? "s" : ""}</label>)}</div>
          <div className="flex flex-wrap items-center gap-3">When late:{AFTER.map((d) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={s.overdueDays.includes(d)} onChange={() => toggle("overdueDays", d)} /> {d} day{d > 1 ? "s" : ""}</label>)}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.smartEarly} onChange={(e) => setS({ ...s, smartEarly: e.target.checked })} /> Remind tenants who paid late before 5 days early</label>
        </>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="flex justify-end"><Button size="sm" onClick={() => void save()}>Save reminders</Button></div>
    </section>
  );
}
