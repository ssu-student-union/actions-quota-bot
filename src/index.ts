import { handleInteraction, runSync, type Interaction } from "./commands.ts";
import { verifySignature } from "./discord.ts";
import { reportFailure } from "./health.ts";
import { barPng } from "./png.ts";
import type { Env } from "./types.ts";

export default {
  async fetch(req, env, ctx) {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.pathname === "/bar.png") {
        const p = Number(url.searchParams.get("p"));
        if (!Number.isFinite(p)) return new Response("bad p", { status: 400 });
        return new Response(await barPng(p), {
          headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
        });
      }
      return new Response("actions-quota-bot");
    }
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await req.text();
    if (!(await verifySignature(req, body, env.DISCORD_PUBLIC_KEY))) {
      return new Response("invalid request signature", { status: 401 });
    }
    return handleInteraction(env, ctx, JSON.parse(body) as Interaction);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runSync(env).catch(async (e: Error) => {
        console.error("scheduled sync failed", e);
        await reportFailure(env, e).catch((err) => console.error("reportFailure failed", err));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
