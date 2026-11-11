// 슬래시 명령 등록: pnpm register
// DISCORD_GUILD_ID가 있으면 해당 서버에 즉시, 없으면 전역(반영까지 최대 1시간)
import { commands } from "../src/definitions.ts";

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error(".dev.vars에 DISCORD_APP_ID, DISCORD_BOT_TOKEN을 채워 주세요.");
  process.exit(1);
}

const path = DISCORD_GUILD_ID
  ? `/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`
  : `/applications/${DISCORD_APP_ID}/commands`;

const res = await fetch(`https://discord.com/api/v10${path}`, {
  method: "PUT",
  headers: { "content-type": "application/json", Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`등록 실패 ${res.status}:`, await res.text());
  process.exit(1);
}
const registered = (await res.json()) as { name: string }[];
console.log(`등록 완료 (${DISCORD_GUILD_ID ? `서버 ${DISCORD_GUILD_ID}` : "전역"}):`, registered.map((c) => `/${c.name}`).join(" "));
