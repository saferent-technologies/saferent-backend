import { CheckCircle2, Trash2, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { AuthVideo } from "@/components/ui/AuthVideo";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { request, upload } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { placesOf, type Where } from "./PropertyPhotos";
import { videoPath, type PropertyDetail, type PropertyVideo } from "./types";

/*
 * Video tours: one per place (building, each flat, each PG room). Every flat needs one before the
 * listing goes for review. New videos wait for review; approving the listing / its changes approves them.
 */

const keyOf = (v: { unitId: string | null; roomId: string | null }) => (v.unitId ? `u:${v.unitId}` : v.roomId ? `r:${v.roomId}` : "common");

export function PropertyVideosTab({ p, editable, canReview, onDone, onError }: { p: PropertyDetail; editable: boolean; canReview: boolean; onDone: (message: string) => void; onError: (message: string) => void }) {
  const places = placesOf(p);
  const videos = p.videos ?? [];
  const [adding, setAdding] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const byPlace = new Map(videos.map((v) => [keyOf(v), v]));
  const orphans = videos.filter((v) => !places.some((w) => w.key === keyOf(v)));

  const moderate = (v: PropertyVideo, decision: "APPROVE" | "REJECT") =>
    confirm({
      title: decision === "APPROVE" ? "Approve video" : "Reject video",
      message: decision === "APPROVE" ? "Tenants can watch this video on the listing." : "The owner sees your note and can upload a new video.",
      tone: decision === "APPROVE" ? "primary" : "danger",
      confirmLabel: decision === "APPROVE" ? "Approve" : "Reject",
      reason: decision === "REJECT" ? { label: "What should the owner fix?", required: true, minLength: 5 } : undefined,
      onConfirm: async (reason) => {
        try {
          await request(`/moderation/videos/${v.id}`, { method: "POST", body: { decision, reason: reason || undefined } });
          onDone(decision === "APPROVE" ? "Video approved." : "Video rejected.");
        } catch (e) {
          onError(errorMessage(e));
          throw e;
        }
      },
    });

  const card = (w: Where | null, v: PropertyVideo) => (
    <div className="space-y-2">
      <div className="relative">
        <AuthVideo path={videoPath(v.id)} className="aspect-video w-full rounded-lg object-contain" />
        <span className="absolute left-2 top-2"><StatusBadge status={v.status} /></span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">{w ? w.label : "Removed place"} · {Math.round(v.durationSec)}s</span>
        <span className="flex gap-1.5">
          {canReview && v.status !== "APPROVED" && <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} onClick={() => moderate(v, "APPROVE")}>Approve</Button>}
          {canReview && v.status !== "REJECTED" && <Button size="sm" variant="danger" leftIcon={<XCircle className="size-4" />} onClick={() => moderate(v, "REJECT")}>Reject</Button>}
          {editable && (
            <button
              type="button"
              aria-label="Delete video"
              className="rounded-control p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
              onClick={() => confirm({ title: "Delete video", message: "This video tour is removed for everyone.", tone: "danger", confirmLabel: "Delete", onConfirm: async () => { await request(`/properties/${p.id}/videos/${v.id}`, { method: "DELETE" }); onDone("Video deleted."); } })}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </span>
      </div>
      {v.status === "REJECTED" && v.rejectionReason && <p className="text-xs text-danger">{v.rejectionReason}</p>}
    </div>
  );

  return (
    <section className="card space-y-6 p-5 sm:p-6">
      <p className="text-sm text-muted">One video tour per place. Every flat needs a video before the listing is sent for review. New videos are reviewed before tenants see them.</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {places.map((w) => {
          const v = byPlace.get(w.key);
          return (
            <div key={w.key} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{w.label}</p>
              {v ? (
                card(w, v)
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-subtle text-sm text-muted">
                  <span>No video yet{w.unitId ? " (needed)" : ""}</span>
                  {editable && <Button size="sm" variant="secondary" leftIcon={<Upload className="size-4" />} onClick={() => setAdding(w.key)}>Add video</Button>}
                </div>
              )}
            </div>
          );
        })}
        {orphans.map((v) => (
          <div key={v.id} className="rounded-lg border border-line p-3">{card(null, v)}</div>
        ))}
      </div>
      {adding && <AddVideoModal p={p} place={places.find((w) => w.key === adding) ?? places[0]} places={places.filter((w) => !byPlace.has(w.key))} onClose={() => setAdding(null)} onDone={(m) => { setAdding(null); onDone(m); }} />}
      {dialog}
    </section>
  );
}

function AddVideoModal({ p, place, places, onClose, onDone }: { p: PropertyDetail; place: Where; places: Where[]; onClose: () => void; onDone: (m: string) => void }) {
  const [where, setWhere] = useState(place.key);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = places.find((w) => w.key === where) ?? place;

  const send = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (target.unitId) form.append("unitId", target.unitId);
      if (target.roomId) form.append("roomId", target.roomId);
      await upload(`/properties/${p.id}/videos`, form);
      onDone("Video uploaded. It's reviewed before tenants see it.");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Modal open onClose={onClose} title="Add video tour" description="MP4 video, recorded or exported as H.264.">
      {err && <Alert kind="error" className="mb-3">{err}</Alert>}
      <Select label="Where is this video from?" options={places.map((w) => ({ value: w.key, label: w.label }))} value={where} onChange={(e) => setWhere(e.target.value)} />
      <input ref={input} type="file" hidden accept="video/mp4" onChange={(e) => void send(e.target.files)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => input.current?.click()}>Choose video</Button>
      </div>
    </Modal>
  );
}
