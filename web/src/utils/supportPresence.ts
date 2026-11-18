import { useEffect, useState } from "react";
import { request } from "@/services/api";

/**
 * Support agent presence for the ticket queue. While "Available" the portal sends a heartbeat every
 * 30 s (POST /support/presence), even in a background tab; closing the portal or "Away" = offline,
 * so the queue stops giving you new tickets. Choice kept per browser (localStorage "sr-support-away").
 */
const KEY = "sr-support-away";
const EVENT = "sr-support-presence";

export function supportAvailable(): boolean {
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return true;
  }
}

export function setSupportAvailable(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "1");
  } catch {
    /* storage blocked: only this page session */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useSupportAvailable(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(supportAvailable);
  useEffect(() => {
    const sync = () => setOn(supportAvailable());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [on, setSupportAvailable];
}

/** Mounted once in the portal layout for staff who handle tickets. */
export function useSupportHeartbeat(enabled: boolean): void {
  const [available] = useSupportAvailable();
  useEffect(() => {
    if (!enabled) return;
    const beat = () => void request("/support/presence", { method: "POST", body: { available } }).catch(() => undefined);
    beat();
    if (!available) return;
    const timer = window.setInterval(beat, 30_000);
    return () => window.clearInterval(timer);
  }, [enabled, available]);
}
