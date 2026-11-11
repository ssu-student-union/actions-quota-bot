import { linkButton, row, sendChannelMessage, type Button, type Embed } from "./discord.ts";
import { actionsUrl, budgetsUrl } from "./github.ts";
import { barImage, COLOR, colorFor, dotFor, esc, freeForecast, mins, pct, UNASSIGNED, usd, usdBudget } from "./format.ts";
import { allRoles, mentionRoles } from "./roles.ts";
import { subButton, subscribersFor } from "./subscriptions.ts";
import type { Env, Snapshot } from "./types.ts";

interface Candidate {
  month: string;
  scope: string;
  /** 지금 넘어선 모든 단계 */
  levels: number[];
  render: (level: number) => Embed;
  /** 알림 아래에 붙일 링크 버튼 */
  buttons?: Button[];
  /** 이 단계의 알림이 역할을 태그할 만큼 중요한지 */
  critical: (level: number) => boolean;
  /** 레포 알림이면 레포 이름 (frontend/backend 태그를 고를 때 씀) */
  repo?: string;
}

export const thresholds = (env: Env) =>
  (env.ALERT_THRESHOLDS || "50,80,100")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

const crossed = (p: number, ts: number[]) => ts.filter((t) => p >= t);

/** 스냅샷에서 알림 후보를 만든다 (이미 보낸 것인지는 아직 따지지 않음) */
export function candidates(env: Env, snap: Snapshot, teams: Map<string, string>): Candidate[] {
  const ts = thresholds(env);
  const out: Candidate[] = [];
  const link = budgetsUrl(env);

  const freeP = pct(snap.usedMinutes, snap.freeMinutes);
  out.push({
    month: snap.month,
    scope: "org-free",
    levels: crossed(freeP, ts),
    critical: (level) => level >= 100, // 무료 분 소진
    render: (level) => ({
      title: level >= 100 ? "🔴 무료 분을 모두 소진했습니다" : `${dotFor(level)} 무료 분의 ${level}%를 사용했습니다`,
      url: link,
      description: [
        `## ${mins(snap.usedMinutes)} / ${mins(snap.freeMinutes)} · ${Math.floor(freeP)}%`,
        level >= 100
          ? "지금부터 레포 예산에서 차감됩니다.\n예산을 다 쓴 레포는 Actions가 정지됩니다."
          : freeForecast(snap),
      ]
        .filter(Boolean)
        .join("\n"),
      image: barImage(env, freeP),
      color: colorFor(level),
    }),
  });

  for (const r of snap.repos) {
    const team = teams.get(r.name) ?? UNASSIGNED;
    if (r.budget !== null && r.budget > 0) {
      const budget = r.budget;
      const p = pct(r.net, budget);
      out.push({
        month: snap.month,
        scope: `budget:${r.name}`,
        repo: r.name,
        levels: crossed(p, ts),
        critical: (level) => level >= 100, // Actions 정지 / 예산 초과
        buttons: [
          linkButton("예산 늘리기", link, "💰"),
          linkButton("Actions 실행 기록", actionsUrl(env, r.name), "📜"),
          subButton("repo", r.name, "이 레포 알림 받기"),
        ],
        render: (level) => ({
          title:
            level >= 100
              ? r.stop
                ? `🔴 ${r.name} 레포의 Actions가 정지되었습니다`
                : `🔴 ${r.name} 레포가 예산을 초과했습니다`
              : `${dotFor(level)} ${r.name} 레포가 예산의 ${level}%를 사용했습니다`,
          url: link,
          description: [
            `## ${Math.floor(p)}%`,
            `-# ${team}`,
            level >= 100
              ? r.stop
                ? `예산 ${usdBudget(budget)}를 모두 사용했습니다.\nGitHub에서 예산을 늘리면 다시 실행됩니다.`
                : "정지 설정이 꺼져 있어 계속 과금됩니다."
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
          image: barImage(env, p),
          color: colorFor(level),
        }),
      });
    }
    if (r.budget === null && r.net >= 0.01) {
      out.push({
        month: snap.month,
        scope: `nobudget-paid:${r.name}`,
        repo: r.name,
        levels: [1],
        critical: () => true, // 멈추지 않고 과금 중
        buttons: [
          linkButton("예산 설정하러 가기", link, "💰"),
          linkButton("Actions 실행 기록", actionsUrl(env, r.name), "📜"),
          subButton("repo", r.name, "이 레포 알림 받기"),
        ],
        render: () => ({
          title: `⚠️ ${r.name} 레포에서 예산 없이 과금되고 있습니다`,
          url: link,
          description: `## ${usd(r.net)}\n예산이 없어\n사용량이 급증해도 정지되지 않습니다.\n-# ${team}`,
          color: COLOR.orange,
        }),
      });
    }
  }
  return out;
}

/** 예산 없이 워크플로만 있는 레포: 한 번만, 여러 개를 하나로 묶어서 알림 */
function unbudgetedWorkflowRepos(snap: Snapshot) {
  return snap.repos.filter((r) => r.budget === null && (r.workflows ?? 0) > 0);
}

export async function processAlerts(env: Env, snap: Snapshot, teams: Map<string, string>) {
  const { results } = await env.DB.prepare("SELECT month, scope, level FROM alerts WHERE month IN (?, 'once')")
    .bind(snap.month)
    .all<{ month: string; scope: string; level: number }>();
  const sent = new Set(results.map((r) => `${r.month}|${r.scope}|${r.level}`));
  const isSent = (month: string, scope: string, level: number) => sent.has(`${month}|${scope}|${level}`);

  type Rec = { month: string; scope: string; level: number };
  /** repos: 이 알림과 관련된 레포 (구독자를 찾는 데 씀) */
  const items: { embed: Embed; buttons?: Button[]; roles?: string[]; repos: string[]; records: Rec[] }[] = [];

  for (const c of candidates(env, snap, teams)) {
    const fresh = c.levels.filter((l) => !isSent(c.month, c.scope, l));
    if (fresh.length === 0) continue;
    const top = Math.max(...fresh);
    // 50%를 건너뛰고 바로 85%가 됐으면 80% 알림 하나만 보내고 50%도 보낸 걸로 기록. 맨 앞이 실제로 보내는 단계
    items.push({
      embed: c.render(top),
      buttons: c.buttons,
      roles: c.critical(top) ? mentionRoles(env, c.repo) : [],
      repos: c.repo ? [c.repo] : [],
      records: [top, ...fresh.filter((l) => l !== top)].map((level) => ({ month: c.month, scope: c.scope, level })),
    });
  }

  const wf = unbudgetedWorkflowRepos(snap).filter((r) => !isSent("once", `nobudget-wf:${r.name}`, 1));
  if (wf.length) {
    items.push({
      buttons: [linkButton("예산 설정하러 가기", budgetsUrl(env), "💰")],
      embed: {
      title: `⚠️ 예산이 설정되지 않은 레포가 ${wf.length}개 있습니다`,
      url: budgetsUrl(env),
      description: [
        ...wf.map((r) => `**${esc(r.name)}** · ${teams.get(r.name) ?? UNASSIGNED}`),
        "",
        "-# 워크플로가 있어, 무료 분을 소진한 뒤 실행되면 제한 없이 과금됩니다.",
      ].join("\n"),
      color: COLOR.orange,
      },
      repos: wf.map((r) => r.name),
      records: wf.map((r) => ({ month: "once", scope: `nobudget-wf:${r.name}`, level: 1 })),
    });
  }

  if (items.length === 0) return { sent: 0 };
  if (!env.ALERT_CHANNEL_ID) {
    console.log("ALERT_CHANNEL_ID 미설정: 알림을 보내지 않음", JSON.stringify(items, null, 2));
    return { sent: 0, skipped: items.length };
  }

  // 버튼은 메시지 단위로 붙기 때문에 알림마다 메시지를 따로 보낸다. 멘션은 중요한 알림에만.
  // 크론과 /sync가 동시에 돌아도 한 번만 보내도록, 보내기 전에 기록을 먼저 잡고(INSERT OR IGNORE)
  // 다른 쪽이 이미 잡았으면 건너뛴다. 보내다 실패하면 잡은 기록을 되돌려 다음 수집 때 다시 보낸다.
  const now = new Date().toISOString();
  const insert = (r: Rec) =>
    env.DB.prepare("INSERT OR IGNORE INTO alerts (month, scope, level, sent_at) VALUES (?, ?, ?, ?)").bind(
      r.month,
      r.scope,
      r.level,
      now,
    );
  const remove = (r: Rec) =>
    env.DB.prepare("DELETE FROM alerts WHERE month = ? AND scope = ? AND level = ? AND sent_at = ?").bind(
      r.month,
      r.scope,
      r.level,
      now,
    );

  let sentCount = 0;
  let firstError: unknown;
  for (const item of items) {
    const results = await env.DB.batch(item.records.map(insert));
    const mine = item.records.filter((_, i) => results[i].meta.changes > 0);
    // 단계 알림은 실제로 보낼 단계(맨 앞)를, 묶음 알림은 하나라도 잡았는지를 본다
    const claimed = item.records[0].month === "once" ? mine.length > 0 : results[0].meta.changes > 0;
    if (!claimed) continue;
    try {
      // 중요한 알림은 역할을, 구독한 사람은 단계와 상관없이 그 레포 알림마다 멘션한다
      const users = await subscribersFor(env, item.repos, teams);
      const mentions = [...(item.roles ?? []).map((r) => `<@&${r}>`), ...users.map((u) => `<@${u}>`)];
      await sendChannelMessage(env, env.ALERT_CHANNEL_ID, {
        content: mentions.length ? mentions.join(" ") : undefined,
        embeds: [item.embed],
        components: item.buttons?.length ? [row(...item.buttons)] : undefined,
        allowed_mentions: { roles: allRoles(env), users },
      });
      sentCount++;
    } catch (e) {
      await env.DB.batch(mine.map(remove));
      firstError ??= e;
    }
  }
  if (firstError) throw firstError;
  return { sent: sentCount };
}
