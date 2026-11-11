import { processAlerts } from "./alerts.ts";
import { collect, loadSnapshot, saveSnapshot } from "./collect.ts";
import { actionButton, editOriginal, EPHEMERAL, json, row, select, type MessageBody } from "./discord.ts";
import { reportRecovery } from "./health.ts";
import { overviewEmbeds, repoEmbed, repoOptions } from "./format.ts";
import { describe, listFor, orgSubButton, parseSubId, repoSubButton, SUB_PREFIX, toggle, toggleOrg, type Kind } from "./subscriptions.ts";
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
  member?: { user?: { id: string } };
  user?: { id: string };
}

/** 수집 → 저장 → 알림. 크론과 /sync, 새로고침 버튼이 같이 쓴다 */
export async function runSync(env: Env, now = new Date()): Promise<Snapshot> {
  const snap = await collect(env, now);
  await saveSnapshot(env, snap);
  await reportRecovery(env);
  const result = await processAlerts(env, snap);
  console.log(`sync ${snap.month}: ${Math.round(snap.usedMinutes)}분, $${snap.net.toFixed(2)}, 알림 ${JSON.stringify(result)}`);

  // GitHub 데이터는 몇 시간 늦게 들어오므로, 매월 1일에는 지난달 마지막 몇 시간치도 다시 확인한다
  if (now.getUTCDate() === 1) {
    const endOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
    const prev = await collect(env, endOfLastMonth);
    const prevResult = await processAlerts(env, prev);
    console.log(`sync ${prev.month} (지난달 재확인): 알림 ${JSON.stringify(prevResult)}`);
  }
  return snap;
}

const REFRESH = "refresh";
const REPO_SELECT = "repo-select";
/** 새로고침을 연타해도 GitHub를 매번 부르지 않도록, 최근 수집이 이보다 새로우면 그대로 쓴다 */
const REFRESH_MIN_INTERVAL_MS = 60_000;

/** /usage 메시지: 레포 드롭다운 + 새로고침 + 전체 사용량 구독 */
function overviewMessage(env: Env, snap: Snapshot): MessageBody {
  const options = repoOptions(snap);
  return {
    embeds: overviewEmbeds(env, snap),
    components: [
      ...(options.length ? [row(select(REPO_SELECT, "레포 자세히 보기", options))] : []),
      row(actionButton("새로고침", REFRESH, "🔄"), orgSubButton()),
    ],
  };
}

// 명령 응답은 모두 본인만 보인다. 채널에 공개되는 건 자동 알림뿐
const ephemeral = (body: MessageBody) => json({ type: R.MESSAGE, data: { ...body, flags: EPHEMERAL } });
const error = (content: string) => ephemeral({ content });

const userOf = (i: Interaction) => i.member?.user?.id ?? i.user?.id;

async function toggleReply(env: Env, i: Interaction, kind: Kind, target: string) {
  const user = userOf(i);
  if (!user) return error("사용자를 확인하지 못했습니다.");
  const on = kind === "org" ? await toggleOrg(env, user) : await toggle(env, user, kind, target);
  const what = describe(kind, target);
  return ephemeral({
    content: on
      ? `🔔 **${what}**을(를) 구독했습니다. 관련 알림이 오면 멘션해 드립니다.\n-# 다시 누르면 구독이 해제됩니다.`
      : `🔕 **${what}** 구독을 해제했습니다.`,
  });
}

/** 시간이 걸리는 작업은 먼저 "생각 중" 응답(본인만 보임)을 보내고 나중에 메시지를 채운다 */
function deferred(env: Env, ctx: ExecutionContext, i: Interaction, work: () => Promise<MessageBody>) {
  ctx.waitUntil(
    work()
      .catch((e: Error) => ({ content: `❌ 실패했습니다: ${e.message.slice(0, 1500)}` }))
      .then((body) => editOriginal(env, i.token, body))
      .catch((e) => console.error("editOriginal failed", e)),
  );
  return json({ type: R.DEFERRED, data: { flags: EPHEMERAL } });
}

export async function handleInteraction(env: Env, ctx: ExecutionContext, i: Interaction): Promise<Response> {
  if (i.type === T.PING) return json({ type: R.PONG });
  if (i.type === T.AUTOCOMPLETE) return autocomplete(env, i);

  if (i.type === T.COMPONENT) {
    const id = i.data?.custom_id ?? "";
    if (id === REPO_SELECT) {
      const repo = i.data?.values?.[0];
      const snap = await loadSnapshot(env);
      const embed = repo && snap ? repoEmbed(env, snap, repo) : null;
      return embed
        ? ephemeral({ embeds: [embed], components: [row(repoSubButton(repo!))] })
        : error("레포를 찾지 못했습니다.");
    }
    if (id === REFRESH) {
      // 버튼이 달린 메시지를 그 자리에서 갱신한다
      ctx.waitUntil(
        (async () => {
          const last = await loadSnapshot(env);
          const fresh = last && Date.now() - Date.parse(last.syncedAt) < REFRESH_MIN_INTERVAL_MS;
          await editOriginal(env, i.token, overviewMessage(env, fresh ? last : await runSync(env)));
        })().catch((e) => console.error("refresh failed", e)),
      );
      return json({ type: R.DEFERRED_UPDATE });
    }
    if (id.startsWith(SUB_PREFIX)) {
      const sub = parseSubId(id);
      return sub ? toggleReply(env, i, sub.kind, sub.target) : error("알 수 없는 버튼입니다.");
    }
    return error("알 수 없는 버튼입니다.");
  }

  if (i.type !== T.COMMAND || !i.data) return error("알 수 없는 요청입니다.");
  const sub = i.data.options?.find((o) => o.type === 1);

  switch (i.data.name) {
    case "usage": {
      const snap = await loadSnapshot(env);
      // 아직 한 번도 수집하지 않았으면 지금 수집
      if (!snap) return deferred(env, ctx, i, async () => overviewMessage(env, await runSync(env)));
      return ephemeral(overviewMessage(env, snap));
    }

    case "sync":
      return deferred(env, ctx, i, async () => overviewMessage(env, await runSync(env)));

    case "subscribe": {
      if (sub?.name === "all") return toggleReply(env, i, "org", "all");
      if (sub?.name === "repo") {
        const name = sub.options?.find((o) => o.name === "repo")?.value?.trim() ?? "";
        const snap = await loadSnapshot(env);
        const known = snap?.repos.find((r) => r.name.toLowerCase() === name.toLowerCase());
        return known ? toggleReply(env, i, "repo", known.name) : error(`\`${name}\` 레포를 찾지 못했습니다.`);
      }
      // list
      const user = userOf(i);
      const subs = user ? await listFor(env, user) : [];
      const org = subs.some((s) => s.kind === "org");
      const repos = subs.filter((s) => s.kind === "repo").map((s) => s.target);
      const lines = [org && "**전체 사용량**", repos.length > 0 && `**레포** · ${repos.join(", ")}`].filter(Boolean);
      return ephemeral({
        content: lines.length
          ? `🔔 구독 중인 알림\n${lines.join("\n")}\n-# 같은 대상으로 \`/subscribe\`를 다시 쓰면 해제됩니다.`
          : "구독 중인 알림이 없습니다.\n-# `/subscribe`나 알림의 🔔 버튼으로 구독할 수 있습니다.",
      });
    }
  }
  return error("알 수 없는 명령입니다.");
}

async function autocomplete(env: Env, i: Interaction): Promise<Response> {
  const sub = i.data?.options?.find((o) => o.type === 1);
  const focused = (sub?.options ?? i.data?.options ?? []).find((o) => o.focused);
  const q = (focused?.value ?? "").toLowerCase();
  const snap = await loadSnapshot(env);
  const choices = (snap?.repos ?? [])
    .filter((r) => !r.archived && r.name.toLowerCase().includes(q))
    .map((r) => r.name)
    .sort()
    .slice(0, 25)
    .map((n) => ({ name: n, value: n }));
  return json({ type: R.AUTOCOMPLETE, data: { choices } });
}
