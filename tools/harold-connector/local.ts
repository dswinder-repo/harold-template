// Local HTTP entry for development and the end-to-end tests: `npm run dev`.
// Needs the same environment variables as production (see README / .env.example);
// PUBLIC_BASE_URL should be http://localhost:<PORT> when running locally.
import { serve } from "@hono/node-server";
import app from "./server.js";

const port = Number(process.env.PORT || 8787);
// Listens on this machine only by default, so plain HTTP is never reachable from outside; put an HTTPS
// reverse proxy in front of it. HOST=0.0.0.0 listens on every interface.
const hostname = process.env.HOST || "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, info => {
  console.log(`harold-connector listening on http://${hostname}:${info.port} (MCP at /mcp)`);
});
