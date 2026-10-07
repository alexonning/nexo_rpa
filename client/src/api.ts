const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? `Falha na API (${response.status})`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
