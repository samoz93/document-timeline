import { initDb } from "./db.ts";
import { handleRpc } from "./rpc.ts";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const DB_PATH = process.env["DB_PATH"] ?? "./healtharch.db";

const db = initDb(DB_PATH);
console.log(`[healtharch] database: ${DB_PATH}`);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS for Vite dev server
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Serve static frontend in production
    if (url.pathname !== "/rpc") {
      const distPath = `./dist/web${url.pathname === "/" ? "/index.html" : url.pathname}`;
      const file = Bun.file(distPath);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not found", { status: 404 });
    }

    // RPC handler
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const response = await handleRpc(db, body as any);
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  },
});

console.log(`[healtharch] server listening on http://localhost:${server.port}`);
