// Local identity & preferences, persisted in localStorage.
// In local-first mode every device has a "self" that exists without any
// server. When the user later connects to a server and logs in, the server
// identity layers on top but the local one is always there as a fallback.

export interface LocalPrefs {
  /** Stable local identity. Server sync maps this to the real account id. */
  id: string;
  display_name: string;
  timezone: string;
  color: string;
}

const KEY = "mincal_prefs";
const LOCAL_ID = "local";

const DEFAULTS: LocalPrefs = {
  id: LOCAL_ID,
  display_name: "本地用户",
  timezone: "Asia/Shanghai",
  color: "#4F46E5",
};

export function getPrefs(): LocalPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...DEFAULTS, ...p, id: LOCAL_ID };
    }
  } catch {
    /* ignore corrupt prefs */
  }
  return { ...DEFAULTS };
}

export function savePrefs(partial: Partial<LocalPrefs>): LocalPrefs {
  const next = { ...getPrefs(), ...partial, id: LOCAL_ID };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
