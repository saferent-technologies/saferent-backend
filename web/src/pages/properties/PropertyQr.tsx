import { Download, Printer } from "lucide-react";
import { AuthImage } from "@/components/ui/AuthImage";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { fetchBlob, request } from "@/services/api";
import type { PropertyDetail } from "./types";

/* QR codes for the property and each flat: print and stick at the gate / door. Scanning opens the SafeRent app. */

interface QrLinks { property: { code: string; title: string; url: string }; units: Array<{ unitId: string; code: string; label: string; url: string }> }

async function download(path: string, name: string, print = false) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  if (print) {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<html><head><title>${name}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh"><img src="${url}" style="width:80vmin" onload="window.print()"></body></html>`);
      w.document.close();
    }
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function PropertyQrTab({ p }: { p: PropertyDetail }) {
  const { data, loading } = useQuery(() => request<QrLinks>(`/properties/${p.id}/qr`), [p.id]);
  if (loading && !data) return <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>;
  if (!data) return null;
  const card = (title: string, path: string, name: string, url: string) => (
    <div key={path} className="rounded-lg border border-line p-3 text-center">
      <AuthImage path={path} alt={`QR code for ${title}`} className="mx-auto aspect-square w-full max-w-[200px]" />
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="truncate text-xs text-muted" title={url}>{url}</p>
      <div className="mt-2 flex justify-center gap-2">
        <Button size="sm" variant="secondary" leftIcon={<Printer className="size-4" />} onClick={() => void download(path, name, true)}>Print</Button>
        <Button size="sm" variant="ghost" leftIcon={<Download className="size-4" />} onClick={() => void download(path, name)}>SVG</Button>
      </div>
    </div>
  );
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="font-semibold">QR codes</h2>
        <p className="text-sm text-muted">Stick these at the gate and on each flat's door. Tenants of the flat can raise a request or see emergency numbers; visitors see the listing; your team can start an inspection.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {card(data.property.title, `/properties/${p.id}/qr.svg`, `${data.property.code}-qr`, data.property.url)}
        {data.units.map((u) => card(u.label, `/properties/${p.id}/qr.svg?unitId=${u.unitId}`, `${u.code}-qr`, u.url))}
      </div>
    </section>
  );
}
