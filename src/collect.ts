import { countWorkflows, fetchBudgets, fetchRepos, fetchUsage } from "./github.ts";
import type { Env, RepoStat, Snapshot } from "./types.ts";

/**
 * 무료 분은 러너 OS마다 배수로 차감된다 (Linux 1배, Windows 2배, macOS 10배).
 * 실행 분 표시도 같은 기준으로 맞춰야 "무료 분의 n%"가 GitHub와 일치한다.
 */
const minuteMultiplier = (sku: string) => (/macos/i.test(sku) ? 10 : /windows/i.test(sku) ? 2 : 1);

/** GitHub에서 그 달의 사용량·예산·레포 정보를 모아 스냅샷을 만든다. now가 속한 달(UTC) 기준 */
export async function collect(env: Env, now = new Date()): Promise<Snapshot> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const [items, budgets, repos] = await Promise.all([
    fetchUsage(env, year, month),
    fetchBudgets(env),
    fetchRepos(env),
  ]);

  const stats = new Map<string, RepoStat>();
  const stat = (name: string) => {
    let s = stats.get(name);
    if (!s) {
      s = { name, minutes: 0, gross: 0, net: 0, budget: null, stop: null, workflows: null };
      stats.set(name, s);
    }
    return s;
  };

  const activePrivate = repos.filter((r) => r.private && !r.archived).map((r) => r.name);
  activePrivate.forEach(stat);

  let usedMinutes = 0;
  let net = 0;
  for (const it of items) {
    if (it.product !== "actions") continue; // 실행 분 + 스토리지 (둘 다 Actions 예산에서 차감)
    net += it.netAmount;
    const s = it.repositoryName ? stat(it.repositoryName) : null;
    if (it.unitType === "Minutes") {
      const m = it.quantity * minuteMultiplier(it.sku);
      usedMinutes += m;
      if (s) s.minutes += m;
    }
    if (s) {
      s.gross += it.grossAmount;
      s.net += it.netAmount;
    }
  }

  for (const b of budgets) {
    if (b.budget_scope !== "repository" || !b.budget_product_sku?.startsWith("actions")) continue;
    const s = stat(b.budget_entity_name.split("/").pop()!);
    // 같은 레포에 예산이 여러 개면 가장 빡빡한 것 기준
    if (s.budget === null || b.budget_amount < s.budget) {
      s.budget = b.budget_amount;
      s.stop = b.prevent_further_usage;
    }
  }

  const archived = new Set(repos.filter((r) => r.archived).map((r) => r.name));
  for (const s of stats.values()) if (archived.has(s.name)) s.archived = true;

  await Promise.all(
    activePrivate
      .map((name) => stats.get(name)!)
      .filter((s) => s.budget === null)
      .map(async (s) => {
        s.workflows = await countWorkflows(env, s.name).catch(() => null);
      }),
  );

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    syncedAt: now.toISOString(),
    freeMinutes: Number(env.FREE_MINUTES) || 2000,
    usedMinutes,
    net,
    repos: [...stats.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function saveSnapshot(env: Env, snap: Snapshot) {
  await env.DB.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('snapshot', ?)")
    .bind(JSON.stringify(snap))
    .run();
}

export async function loadSnapshot(env: Env): Promise<Snapshot | null> {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key = 'snapshot'").first<{ value: string }>();
  return row ? (JSON.parse(row.value) as Snapshot) : null;
}

export async function loadTeams(env: Env): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare("SELECT repo, team FROM repo_team").all<{ repo: string; team: string }>();
  return new Map(results.map((r) => [r.repo, r.team]));
}
