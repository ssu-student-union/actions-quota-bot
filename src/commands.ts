import { processAlerts } from "./alerts.ts";
import { collect, loadSnapshot, loadTeams, saveSnapshot } from "./collect.ts";
import { actionButton, editOriginal, EPHEMERAL, json, row, select, type MessageBody } from "./discord.ts";
import { reportRecovery } from "./health.ts";
import { overviewEmbeds, repoEmbed, teamEmbed, teamListEmbed, teamOptions, UNASSIGNED } from "./format.ts";
import type { Env, Snapshot } from "./types.ts";

const T = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4 } as const;
const R = { PONG: 1, MESSAGE: 4, DEFERRED: 5, DEFERRED_UPDATE: 6, AUTOCOMPLETE: 8 } as const;

interface Option {
  name: string;
  type: number;
  value?: string;
  focused?: boolean;
  options?: Option[];
}

export interface Interaction {
  type: number;
  token: string;
  data?: { name: string; options?: Option[]; custom_id?: string; values?: string[] };
  member?: { roles: string[]; permissions: string };
}

/** 수집 → 저장 → 알림. 크론과 /sync, 새로고침 버튼이 같이 쓴다 */
export async function runSync(env: Env, now = new Date()): Promise<Snapshot> {
  const snap = await collect(env, now);
  await saveSnapshot(env, snap);
  await reportRecovery(env);
  const teams = await loadTeams(env);
  const result = await processAlerts(env, snap, teams);
  console.log(`sync ${snap.month}: ${Math.round(snap.usedMinutes)}분, $${snap.net.toFixed(2)}, 알림 ${JSON.stringify(result)}`);

  // GitHub 데이터는 몇 시간 늦게 들어오므로, 매월 1일에는 지난달 마지막 몇 시간치도 다시 확인한다
  if (now.getUTCDate() === 1) {
    const endOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
    const prev = await collect(env, endOfLastMonth);
    const prevResult = await processAlerts(env, prev, teams);
    console.log(`sync ${prev.month} (지난달 재확인): 알림 ${JSON.stringify(prevResult)}`);
  }
  return snap;
}

const REFRESH = "refresh";
const TEAM_SELECT = "team-select";
/** 새로고침을 연타해도 GitHub를 매번 부르지 않도록, 최근 수집이 이보다 새로우면 그대로 쓴다 */
const REFRESH_MIN_INTERVAL_MS = 60_000;

/** /usage 전체 현황 메시지 (새로고침 버튼 포함) */
async function overviewMessage(env: Env, snap: Snapshot): Promise<MessageBody> {
  const teams = await loadTeams(env);
  const options = teamOptions(snap, teams);
  return {
    embeds: overviewEmbeds(env, snap, teams),
    components: [
      ...(options.length ? [row(select(TEAM_SELECT, "TF 자세히 보기", options))] : []),
      row(actionButton("새로고침", REFRESH, "🔄")),
    ],
  };
}

const reply = (body: MessageBody) => json({ type: R.MESSAGE, data: body });
const error = (content: string) => reply({ content, flags: EPHEMERAL });

function flatten(options: Option[] = []): { sub?: string; args: Map<string, Option> } {
  const sub = options.find((o) => o.type === 1);
  const list = sub ? (sub.options ?? []) : options;
  return { sub: sub?.name, args: new Map(list.map((o) => [o.name, o])) };
}

const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;
function isAdmin(env: Env, i: Interaction) {
  if (!i.member) return false;
  if (env.ADMIN_ROLE_ID && i.member.roles.includes(env.ADMIN_ROLE_ID)) return true;
  const perms = BigInt(i.member.permissions ?? "0");
  return (perms & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
}

/** 시간이 걸리는 작업은 먼저 "생각 중" 응답을 보내고 나중에 메시지를 채운다 */
function deferred(
  env: Env,
  ctx: ExecutionContext,
  i: Interaction,
  work: () => Promise<MessageBody>,
  { ephemeral = false } = {},
) {
  ctx.waitUntil(
    work()
      .catch((e: Error) => ({ content: `❌ 실패했습니다: ${e.message.slice(0, 1500)}` }))
      .then((body) => editOriginal(env, i.token, body))
      .catch((e) => console.error("editOriginal failed", e)),
  );
  // 지연 응답의 공개 여부는 여기서 정해지고, 나중에 채우는 메시지도 그대로 따른다
  return json({ type: R.DEFERRED, data: ephemeral ? { flags: EPHEMERAL } : {} });
}

export async function handleInteraction(env: Env, ctx: ExecutionContext, i: Interaction): Promise<Response> {
  if (i.type === T.PING) return json({ type: R.PONG });
  if (i.type === T.AUTOCOMPLETE) return autocomplete(env, i);
  if (i.type === T.COMPONENT && i.data?.custom_id === TEAM_SELECT) {
    // 고른 TF 상세는 고른 사람에게만 보여 준다 (원래 메시지는 그대로)
    const team = i.data.values?.[0];
    const snap = await loadSnapshot(env);
    const embed = team && snap ? teamEmbed(env, snap, await loadTeams(env), team) : null;
    return embed ? reply({ embeds: [embed], flags: EPHEMERAL }) : error("TF를 찾지 못했습니다.");
  }
  if (i.type === T.COMPONENT && i.data?.custom_id === REFRESH) {
    // 버튼이 달린 메시지를 그 자리에서 갱신한다
    ctx.waitUntil(
      (async () => {
        const last = await loadSnapshot(env);
        const fresh = last && Date.now() - Date.parse(last.syncedAt) < REFRESH_MIN_INTERVAL_MS;
        await editOriginal(env, i.token, await overviewMessage(env, fresh ? last : await runSync(env)));
      })().catch((e) => console.error("refresh failed", e)),
    );
    return json({ type: R.DEFERRED_UPDATE });
  }
  if (i.type !== T.COMMAND || !i.data) return error("알 수 없는 요청입니다.");

  const { sub, args } = flatten(i.data.options);
  const arg = (name: string) => args.get(name)?.value?.trim();

  switch (i.data.name) {
    case "usage": {
      const snap = await loadSnapshot(env);
      const render = async (s: Snapshot): Promise<MessageBody> => {
        const teams = await loadTeams(env);
        const repo = arg("repo");
        const team = arg("team");
        if (!repo && !team) return overviewMessage(env, s);
        const embed = repo ? repoEmbed(env, s, teams, repo) : teamEmbed(env, s, teams, team!);
        if (!embed) return { content: `\`${repo ?? team}\`을(를) 찾지 못했습니다.` };
        return { embeds: [embed] };
      };
      // 명령 응답은 모두 본인만 보인다. 채널에 공개되는 건 자동 알림뿐
      if (!snap) return deferred(env, ctx, i, async () => render(await runSync(env)), { ephemeral: true });
      return reply({ ...(await render(snap)), flags: EPHEMERAL });
    }

    case "sync":
      return deferred(
        env,
        ctx,
        i,
        async () => {
          return overviewMessage(env, await runSync(env));
        },
        { ephemeral: true },
      );

    case "team": {
      if (sub === "list") {
        const [snap, teams] = await Promise.all([loadSnapshot(env), loadTeams(env)]);
        return reply({ embeds: [teamListEmbed(snap, teams)], flags: EPHEMERAL });
      }
      if (!isAdmin(env, i)) return error("TF 설정은 운영진만 바꿀 수 있습니다.");
      const repo = arg("repo");
      const team = arg("team");
      const newName = sub === "rename" ? arg("name") : team;
      if (newName === UNASSIGNED) return error(`'${UNASSIGNED}'은 TF 이름으로 쓸 수 없습니다. 배정을 빼려면 \`/team unassign\`을 쓰시기 바랍니다.`);
      if (sub === "assign" && repo && team) {
        const snap = await loadSnapshot(env);
        const known = snap?.repos.find((r) => r.name.toLowerCase() === repo.toLowerCase());
        const name = known?.name ?? repo;
        await env.DB.prepare("INSERT OR REPLACE INTO repo_team (repo, team) VALUES (?, ?)").bind(name, team).run();
        const warn = known ? "" : "\n-# 최근 수집 결과에 없는 레포입니다. 이름이 맞는지 확인해 주시기 바랍니다.";
        return reply({ content: `✅ \`${name}\` → **${team}**${warn}`, flags: EPHEMERAL });
      }
      if (sub === "unassign" && repo) {
        const r = await env.DB.prepare("DELETE FROM repo_team WHERE repo = ? COLLATE NOCASE").bind(repo).run();
        return r.meta.changes
          ? reply({ content: `✅ \`${repo}\`을(를) TF에서 뺐습니다.`, flags: EPHEMERAL })
          : error(`\`${repo}\`은(는) 배정된 TF가 없습니다.`);
      }
      const name = arg("name");
      if (sub === "rename" && team && name) {
        const r = await env.DB.prepare("UPDATE repo_team SET team = ? WHERE team = ?").bind(name, team).run();
        return r.meta.changes
          ? reply({ content: `✅ **${team}** → **${name}** (레포 ${r.meta.changes}개)`, flags: EPHEMERAL })
          : error(`**${team}** TF를 찾지 못했습니다.`);
      }
      return error("명령을 이해하지 못했습니다.");
    }
  }
  return error("알 수 없는 명령입니다.");
}

async function autocomplete(env: Env, i: Interaction): Promise<Response> {
  const { args } = flatten(i.data?.options);
  const focused = [...args.values()].find((o) => o.focused);
  const q = (focused?.value ?? "").toLowerCase();
  let names: string[] = [];
  if (focused?.name === "team") {
    const { results } = await env.DB.prepare("SELECT DISTINCT team FROM repo_team ORDER BY team").all<{ team: string }>();
    names = results.map((r) => r.team);
    // 조회(/usage)에서는 배정 안 된 레포 묶음도 고를 수 있게 (드롭다운과 같게)
    if (i.data?.name === "usage") names.push(UNASSIGNED);
  } else if (focused?.name === "repo") {
    const [snap, teams] = await Promise.all([loadSnapshot(env), loadTeams(env)]);
    names = [...new Set([...(snap?.repos.map((r) => r.name) ?? []), ...teams.keys()])].sort();
  }
  const choices = names
    .filter((n) => n.toLowerCase().includes(q))
    .slice(0, 25)
    .map((n) => ({ name: n, value: n }));
  return json({ type: R.AUTOCOMPLETE, data: { choices } });
}
