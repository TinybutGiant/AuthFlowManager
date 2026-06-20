import { QueryClient, QueryFunction } from "@tanstack/react-query";

// JWT Token management
const TOKEN_KEY = 'auth_token';

export const tokenManager = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  removeToken: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  bodyText: string;
  serverMessage: string;

  constructor(status: number, serverMessage: string, body: unknown, bodyText: string) {
    super(`${status}: ${serverMessage}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.bodyText = bodyText;
    this.serverMessage = serverMessage;
  }
}

function parseErrorBody(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getServerMessage(body: unknown, text: string, fallback: string) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return text || fallback;
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.serverMessage || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const body = parseErrorBody(text);
    const serverMessage = getServerMessage(body, text, res.statusText);
    throw new ApiError(res.status, serverMessage, body, text);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const token = tokenManager.getToken();
  const headers: Record<string, string> = {};
  
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const token = tokenManager.getToken();
    const headers: Record<string, string> = {};
    
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(queryKey.join("/") as string, { headers });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
