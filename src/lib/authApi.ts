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
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    if (response.status === 404 || response.status === 405 || contentType.toLowerCase().includes("text/html")) {
      throw new Error("The Veyra API did not respond. Configure the /api proxy to reach your VPS API, then try again.");
    }
    throw new Error("The authentication service returned an invalid response. Please try again shortly.");
  }
  let result: { error?: string };
  try {
    result = await response.json();
  } catch {
    throw new Error("The authentication service returned an invalid response. Please try again shortly.");
  }
  if (!response.ok) throw new Error(result.error || "Authentication request failed.");
  return result as T;
}

export function notifyAuthChanged() {
  window.dispatchEvent(new Event("veyra-auth-changed"));
}
