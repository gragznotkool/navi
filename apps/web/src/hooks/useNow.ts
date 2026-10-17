import { useEffect, useState } from "react";

/**
 * Re-renders the component at the given interval in milliseconds (default: 1000ms),
 * returning the current timestamp (Date.now()).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
