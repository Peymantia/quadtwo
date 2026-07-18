import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) =>
  c.json({
    ok: true,
    service: "quadtwo-server",
    time: new Date().toISOString(),
  }),
);
