export type VeyraUser = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  user_metadata: { username: string; display_name: string };
};

export async function authRequest<T = { ok: boolean; message?: string }>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Authentication request failed.");
  return result as T;
}

export function notifyAuthChanged() {
  window.dispatchEvent(new Event("veyra-auth-changed"));
}
