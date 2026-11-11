// 개인 알림 구독. 전체 사용량(무료 분 알림) 또는 레포 단위로 구독하면, 해당 알림이 나갈 때 멘션한다.
import { actionButton, type Button } from "./discord.ts";
import type { Env } from "./types.ts";

export type Kind = "org" | "repo";
const ORG_TARGET = "all";

/** 버튼 custom_id: "sub:org:all" / "sub:repo:<레포>" */
export const SUB_PREFIX = "sub:";
export const orgSubButton = (): Button => actionButton("전체 사용량 구독하기", `${SUB_PREFIX}org:${ORG_TARGET}`, "🔔");
export const repoSubButton = (repo: string): Button =>
  actionButton("이 레포 구독하기", `${SUB_PREFIX}repo:${repo}`.slice(0, 100), "🔔");

export function parseSubId(customId: string): { kind: Kind; target: string } | null {
  const m = customId.match(/^sub:(org|repo):(.+)$/);
  return m ? { kind: m[1] as Kind, target: m[2] } : null;
}

export const describe = (kind: Kind, target: string) => (kind === "org" ? "전체 사용량" : `${target} 레포`);

/** 구독 상태를 뒤집는다. 구독하게 됐으면 true */
export async function toggle(env: Env, userId: string, kind: Kind, target: string): Promise<boolean> {
  const del = await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ? AND kind = ? AND target = ?")
    .bind(userId, kind, target)
    .run();
  if (del.meta.changes > 0) return false;
  await env.DB.prepare("INSERT INTO subscriptions (user_id, kind, target) VALUES (?, ?, ?)")
    .bind(userId, kind, target)
    .run();
  return true;
}

export const toggleOrg = (env: Env, userId: string) => toggle(env, userId, "org", ORG_TARGET);

export async function listFor(env: Env, userId: string) {
  const { results } = await env.DB.prepare("SELECT kind, target FROM subscriptions WHERE user_id = ? ORDER BY kind, target")
    .bind(userId)
    .all<{ kind: Kind; target: string }>();
  return results;
}

/** 알림을 받을 사람들: org 알림이면 전체 사용량 구독자, 레포 알림이면 그 레포 구독자 */
export async function subscribersFor(env: Env, target: { org: true } | { repos: string[] }): Promise<string[]> {
  if ("org" in target) {
    const { results } = await env.DB.prepare("SELECT DISTINCT user_id FROM subscriptions WHERE kind = 'org'").all<{ user_id: string }>();
    return results.map((r) => r.user_id);
  }
  if (target.repos.length === 0) return [];
  const marks = target.repos.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(`SELECT DISTINCT user_id FROM subscriptions WHERE kind = 'repo' AND target IN (${marks})`)
    .bind(...target.repos)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}
