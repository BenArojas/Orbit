/**
 * useMediaQuery — subscribe a component to a CSS media query.
 *
 * Returns `true` when the query matches. Re-renders on match changes.
 * Safe for SSR / test envs where `window.matchMedia` is undefined
 * (returns false initially and never updates).
 *
 * Usage:
 *   const isTall = useMediaQuery('(min-height: 900px)');
 */

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const getMatch = () => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Sync on mount (query may have changed between state init and effect)
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export default useMediaQuery;
