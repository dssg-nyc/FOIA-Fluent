import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface UserProfile {
  full_name: string;
  organization: string;
  email: string;
  phone: string;
  mailing_address: string;
  requester_category: string;
}

export type UpdateUserProfilePayload = Partial<UserProfile>;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function getProfile(): Promise<UserProfile> {
  const res = await fetch(`${API_URL}/api/v1/profile`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load profile: ${res.status}`);
  return res.json();
}

export async function updateProfile(
  payload: UpdateUserProfilePayload,
): Promise<UserProfile> {
  const res = await fetch(`${API_URL}/api/v1/profile`, {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to save profile: ${res.status}`);
  return res.json();
}
