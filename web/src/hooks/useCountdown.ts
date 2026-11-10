import { useEffect, useState } from "react";

/** Whole seconds remaining until `targetMs` (epoch ms). Returns 0 when reached or when target is null. */
export function useCountdown(targetMs: number | null): number {
  const compute = () => (targetMs ? Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)) : 0);
  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    if (!targetMs) return;
    const id = window.setInterval(() => {
      const next = compute();
      setSeconds(next);
      if (next <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMs]);

  return seconds;
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
