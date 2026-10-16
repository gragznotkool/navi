import type { RequestHandler, Router } from "express";

export interface RouteEntry {
  method: "GET" | "POST" | "PUT";
  path: string;
  status: "implemented" | "not-implemented";
}

/** Every route is registered through `mount`, so docs/tests can compare the real surface to OpenAPI. */
export const manifest: RouteEntry[] = [];

export function mount(router: Router, base = "") {
  const add = (method: RouteEntry["method"], path: string, status: RouteEntry["status"]) =>
    manifest.push({ method, path: `/api/v1${base}${path}`, status });
  return {
    get: (path: string, ...h: RequestHandler[]) => (add("GET", path, "implemented"), router.get(path, ...h)),
    post: (path: string, ...h: RequestHandler[]) => (add("POST", path, "implemented"), router.post(path, ...h)),
    put: (path: string, ...h: RequestHandler[]) => (add("PUT", path, "implemented"), router.put(path, ...h)),
    /** Registers an honest 501 for a documented but unbuilt endpoint. */
    unavailable: (method: RouteEntry["method"], path: string, ...handlers: RequestHandler[]) => {
      add(method, path, "not-implemented");
      router[method.toLowerCase() as "get" | "post" | "put"](path, ...handlers);
    },
  };
}
