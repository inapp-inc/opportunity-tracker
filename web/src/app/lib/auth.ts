const TOKEN_KEY = 'pt_access_token';

/** Session tab uses sessionStorage; remembered sessions use localStorage. */
export function getToken(): string | null {
  try {
    const fromSession = sessionStorage.getItem(TOKEN_KEY);
    if (fromSession) return fromSession;
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string, remember: boolean): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
