// 크론 수집이 실패하면 알림 채널에 알린다 (하루 1번). 다시 성공하면 복구 알림.
import { linkButton, row, sendChannelMessage } from "./discord.ts";
import { COLOR } from "./format.ts";
import type { Env } from "./types.ts";

interface FailState {
  since: string;
  /** 마지막으로 실패 알림을 보낸 날 (KST, YYYY-MM-DD) */
  notifiedDay: string;
}

const KEY = "sync_fail";
const kstDay = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

async function load(env: Env): Promise<FailState | null> {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as FailState) : null;
}

const save = (env: Env, s: FailState) =>
  env.DB.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").bind(KEY, JSON.stringify(s)).run();

const isGitHub = (message: string) => /^GitHub \d/.test(message);

/** 응답 코드로 원인을 짐작해 한 줄로 */
function hint(message: string) {
  if (/^Discord \d/.test(message)) return "디스코드 알림 발송에 실패했습니다. 봇 권한이나 알림 채널 설정을 확인해 주시기 바랍니다.";
  if (/GitHub 401/.test(message)) return "GitHub 토큰이 만료됐거나 폐기됐습니다.";
  if (/GitHub 403|GitHub 404/.test(message)) return "토큰 권한이 부족하거나, 토큰 주인이 org 관리자 권한을 잃었습니다.";
  if (/GitHub 5\d\d/.test(message)) return "GitHub 쪽 일시적인 장애일 수 있습니다.";
  return "아래 에러를 확인해 주시기 바랍니다.";
}

export async function reportFailure(env: Env, error: Error) {
  if (!env.ALERT_CHANNEL_ID) return;
  const prev = await load(env);
  const today = kstDay();
  if (prev?.notifiedDay === today) return;
  const who = env.FAILURE_MENTION_USER_ID;
  await sendChannelMessage(env, env.ALERT_CHANNEL_ID, {
    content: who ? `<@${who}>` : undefined,
    allowed_mentions: { users: who ? [who] : [] },
    embeds: [
      {
        title: isGitHub(error.message) ? "⚠️ GitHub 사용량을 가져오지 못했습니다" : "⚠️ 사용량 확인 중 오류가 발생했습니다",
        description: [
          hint(error.message),
          "고칠 때까지 사용량 알림이 오지 않습니다.",
          `-# ${error.message.slice(0, 300)}`,
        ].join("\n"),
        color: COLOR.orange,
        timestamp: new Date().toISOString(),
      },
    ],
    components: isGitHub(error.message)
      ? [row(linkButton("토큰 관리", "https://github.com/settings/personal-access-tokens", "🔑"))]
      : undefined,
  });
  await save(env, { since: prev?.since ?? new Date().toISOString(), notifiedDay: today });
}

export async function reportRecovery(env: Env) {
  const prev = await load(env);
  if (!prev) return;
  await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(KEY).run();
  if (!env.ALERT_CHANNEL_ID) return;
  await sendChannelMessage(env, env.ALERT_CHANNEL_ID, {
    embeds: [{ title: "✅ GitHub 사용량 수집이 다시 정상입니다", color: COLOR.green, timestamp: new Date().toISOString() }],
  });
}
