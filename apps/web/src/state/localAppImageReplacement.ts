import { useCallback, useEffect, useRef, useState } from "react";

export const LOCAL_APP_IMAGE_RESTART_CONFIRMATION =
  "Restart T3 Code to use the new local build?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.";
const REPLACEMENT_CHECK_INTERVAL_MS = 30_000;

export async function restartWithLocalAppImage({
  confirm,
  restart,
}: {
  readonly confirm: (message: string) => Promise<boolean>;
  readonly restart: () => Promise<boolean>;
}): Promise<"cancelled" | "unavailable" | "restarting"> {
  if (!(await confirm(LOCAL_APP_IMAGE_RESTART_CONFIRMATION))) return "cancelled";
  return (await restart()) ? "restarting" : "unavailable";
}

export function useLocalAppImageReplacement() {
  const [available, setAvailable] = useState(false);
  const currentRead = useRef(0);
  const refresh = useCallback(async () => {
    const read = ++currentRead.current;
    const check = window.desktopBridge?.getLocalAppImageReplacement;
    if (!check) {
      setAvailable(false);
      return;
    }
    try {
      const replacement = await check();
      if (currentRead.current === read) setAvailable(replacement);
    } catch {
      if (currentRead.current === read) setAvailable(false);
    }
  }, []);

  useEffect(() => {
    if (!window.desktopBridge?.getLocalAppImageReplacement) return;
    void refresh();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, REPLACEMENT_CHECK_INTERVAL_MS);
    return () => {
      currentRead.current++;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { available, refresh };
}
