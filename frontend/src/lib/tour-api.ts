import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface UserProfile {
  tour_completed_at: string | null;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}/api/v1${path}`, { ...options, headers });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

/** Read the current user's profile flags (used to decide whether to auto-launch the tour). */
export async function getUserProfile(): Promise<UserProfile> {
  return apiFetch("/user/profile");
}

/** Mark the onboarding tour as completed for the current user (idempotent). */
export async function markTourComplete(): Promise<UserProfile> {
  return apiFetch("/user/tour-complete", { method: "POST" });
}
