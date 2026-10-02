// Local HTTP entry for development and the end-to-end tests: `npm run dev`.
// Needs the same environment variables as production (see README / .env.example);
// PUBLIC_BASE_URL should be http://localhost:<PORT> when running locally.
import { serve } from "@hono/node-server";
import app from "./server.js";

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, info => {
  console.log(`harold-connector listening on http://localhost:${info.port} (MCP at /mcp)`);
});
