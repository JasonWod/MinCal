export interface User {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  timezone: string;
  color: string;
}

export interface EventItem {
  id: string;
  owner_id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  recurrence?: string;
  reminder_min?: number;
  color?: string;
  visibility: "private" | "busy" | "public";
  all_day: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  deleted?: boolean;
}

export interface EventCreate {
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  recurrence?: string;
  reminder_min?: number;
  color?: string;
  visibility?: "private" | "busy" | "public";
  all_day?: boolean;
  attendees?: string[];
}

export interface EventUpdate extends Partial<EventCreate> {
  id?: string;
}

export interface SyncResult {
  events: EventItem[];
  version: number;
}

export interface PushResult {
  results: { id: string; status: string; version?: number }[];
}

// "local" = running standalone (no server configured) — the default.
// "synced"/"syncing"/"offline"/"error" apply once a server is connected.
export type SyncStatus = "local" | "synced" | "syncing" | "offline" | "error";
