import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/utils/errors";

/**
 * Minimal data-fetching hook: runs `fn` whenever `key` changes, exposes data/loading/error and
 * `reload()`. Stale responses (from an older key) are ignored.
 */
export function useQuery<T>(fn: () => Promise<T>, key: unknown[], enabled = true) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (current === seq.current) setData(result);
    } catch (err) {
      if (current === seq.current) setError(errorMessage(err));
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, []);

  const keyString = JSON.stringify(key);
  useEffect(() => {
    if (enabled) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyString, enabled]);

  return { data, error, loading, reload: run, setData };
}
