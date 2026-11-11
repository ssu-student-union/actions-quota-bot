// 개인 알림 구독. 레포 / TF / 파트(frontend·backend) 단위로 구독하면,
// 해당하는 레포 알림이 나갈 때 그 사람을 멘션한다.
import { actionButton, type Button } from "./discord.ts";
import { UNASSIGNED } from "./format.ts";
import { partOf, type Part } from "./roles.ts";
import type { Env } from "./types.ts";

export type Kind = "repo" | "team" | "part";
export const PART_LABEL: Record<Part, string> = { frontend: "프론트엔드", backend: "백엔드" };

/** 버튼 custom_id: "sub:<kind>:<target>" */
export const SUB_PREFIX = "sub:";
export const subButton = (kind: Kind, target: string, label: string): Button =>
  actionButton(label, `${SUB_PREFIX}${kind}:${target}`.slice(0, 100), "🔔");

export function parseSubId(customId: string): { kind: Kind; target: string } | null {
  const m = customId.match(/^sub:(repo|team|part):(.+)$/);
  return m ? { kind: m[1] as Kind, target: m[2] } : null;
}

export function describe(kind: Kind, target: string) {
  if (kind === "part") return `${PART_LABEL[target as Part] ?? target} 전체`;
  if (kind === "team") return `${target} TF`;
  return `${target} 레포`;
}

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

export async function listFor(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT kind, target FROM subscriptions WHERE user_id = ? ORDER BY kind, target",
  )
    .bind(userId)
    .all<{ kind: Kind; target: string }>();
  return results;
}

/**
 * 이 레포들 알림을 받을 사람들. 레포·TF·파트 중 하나라도 맞으면 포함.
 * 파트를 알 수 없는 레포는 frontend·backend 구독자 모두에게 (역할 태그와 같은 규칙).
 */
export async function subscribersFor(env: Env, repos: string[], teams: Map<string, string>): Promise<string[]> {
  if (repos.length === 0) return [];
  const { results } = await env.DB.prepare("SELECT user_id, kind, target FROM subscriptions").all<{
    user_id: string;
    kind: Kind;
    target: string;
  }>();
  const users = new Set<string>();
  for (const repo of repos) {
    const team = teams.get(repo) ?? UNASSIGNED;
    const part = partOf(repo);
    for (const s of results) {
      const hit =
        (s.kind === "repo" && s.target === repo) ||
        (s.kind === "team" && s.target === team) ||
        (s.kind === "part" && (part === null || s.target === part));
      if (hit) users.add(s.user_id);
    }
  }
  return [...users];
}
