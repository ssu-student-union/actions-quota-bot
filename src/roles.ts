// 중요한 알림 때 누구를 태그할지. 레포 이름으로 frontend / backend를 가른다.
import type { Env } from "./types.ts";

export type Part = "frontend" | "backend";

const FRONTEND = /front|[-_]ui$|landing|web/i;
const BACKEND = /back|api|server|auth|aws|infra|monitoring|logcleaner|instance|bot/i;

/** 레포 이름으로 담당 파트를 추정. 둘 다 아니면 null (양쪽 모두 태그) */
export function partOf(repo: string): Part | null {
  if (FRONTEND.test(repo)) return "frontend";
  if (BACKEND.test(repo)) return "backend";
  return null;
}

/**
 * 태그할 역할 ID 목록. 레포 알림은 그 레포 파트만, 조직 전체 알림(repo 없음)이나
 * 파트를 모르는 레포는 frontend·backend 모두. ALERT_MENTION_ROLE_ID(예: 운영진)는 항상 함께.
 */
export function mentionRoles(env: Env, repo?: string): string[] {
  const part = repo ? partOf(repo) : null;
  const roles = [
    env.ALERT_MENTION_ROLE_ID,
    part !== "backend" ? env.FRONTEND_ROLE_ID : "",
    part !== "frontend" ? env.BACKEND_ROLE_ID : "",
  ];
  return [...new Set(roles.filter(Boolean))];
}

export const allRoles = (env: Env) =>
  [env.ALERT_MENTION_ROLE_ID, env.FRONTEND_ROLE_ID, env.BACKEND_ROLE_ID].filter(Boolean);
