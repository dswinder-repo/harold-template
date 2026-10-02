// Vercel entrypoint (zero-config Hono backend on Fluid compute). Also imported by local.ts.
import { Hono } from "hono";
import { createApp } from "./src/app.js";

const app: Hono = createApp();
export default app;
