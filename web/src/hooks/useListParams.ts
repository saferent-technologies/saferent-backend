import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

/**
 * List state (page, search, filters) stored in the URL so it survives refresh and back/forward.
 *   const list = useListParams(["status", "role"]);
 *   list.query  -> { page, q, status, role } ready for the API
 */
export function useListParams(filterNames: string[] = []) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";
  const filters = useMemo(() => Object.fromEntries(filterNames.map((n) => [n, params.get(n) ?? ""])), [params, filterNames]);

  const update = useCallback(
    (changes: Record<string, string | number | undefined>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === undefined || v === "") next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !("page" in changes)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    page,
    q,
    filters,
    query: { page, q, ...filters },
    setPage: (p: number) => update({ page: p }, false),
    setSearch: (value: string) => update({ q: value }),
    setFilter: (name: string, value: string) => update({ [name]: value }),
    params,
    update,
  };
}
