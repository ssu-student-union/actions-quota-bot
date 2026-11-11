import type { Env } from "./types.ts";

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

export interface Button {
  type: 2;
  /** 2 = 회색 버튼(동작), 5 = 링크 */
  style: 2 | 5;
  label: string;
  emoji?: { name: string };
  url?: string;
  custom_id?: string;
}

export const linkButton = (label: string, url: string, emoji?: string): Button => ({
  type: 2,
  style: 5,
  label,
  url,
  ...(emoji ? { emoji: { name: emoji } } : {}),
});

export const actionButton = (label: string, custom_id: string, emoji?: string): Button => ({
  type: 2,
  style: 2,
  label,
  custom_id,
  ...(emoji ? { emoji: { name: emoji } } : {}),
});

export interface SelectMenu {
  type: 3;
  custom_id: string;
  placeholder?: string;
  /** 최대 25개 */
  options: { label: string; value: string; description?: string; emoji?: { name: string } }[];
}

export const select = (custom_id: string, placeholder: string, options: SelectMenu["options"]): SelectMenu => ({
  type: 3,
  custom_id,
  placeholder,
  options: options.slice(0, 25),
});

/** 컴포넌트 한 줄: 버튼 최대 5개, 또는 드롭다운 1개 */
export const row = (...components: (Button | SelectMenu)[]) => ({ type: 1 as const, components });
export type ActionRow = ReturnType<typeof row>;

export interface MessageBody {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  flags?: number;
  allowed_mentions?: { parse?: string[]; roles?: string[]; users?: string[] };
}

export const EPHEMERAL = 64;

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));

export async function verifySignature(req: Request, body: string, publicKey: string): Promise<boolean> {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts || !publicKey) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + body));
  } catch {
    return false;
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function discord(env: Env, method: string, path: string, body: unknown, auth = true, retried = false) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  // 알림을 연달아 보내다 속도 제한에 걸리면 한 번 기다렸다 다시 보낸다
  if (res.status === 429 && !retried) {
    const { retry_after = 1 } = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.min(retry_after, 10) * 1000));
    return discord(env, method, path, body, auth, true);
  }
  if (!res.ok) throw new Error(`Discord ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
}

export const sendChannelMessage = (env: Env, channelId: string, body: MessageBody) =>
  discord(env, "POST", `/channels/${channelId}/messages`, body);

/** 지연 응답(type 5)을 보낸 뒤 원래 메시지를 채운다. 인터랙션 토큰으로 인증하므로 봇 토큰 불필요 */
export const editOriginal = (env: Env, token: string, body: MessageBody) =>
  discord(env, "PATCH", `/webhooks/${env.DISCORD_APP_ID}/${token}/messages/@original`, body, false);
