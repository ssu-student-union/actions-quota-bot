import { budgetsUrl } from "./github.ts";
import type { Embed } from "./discord.ts";
import type { Env, RepoStat, Snapshot } from "./types.ts";

export const UNASSIGNED = "미배정";

export const COLOR = { green: 0x2ecc71, yellow: 0xf1c40f, orange: 0xe67e22, red: 0xe74c3c, gray: 0x95a5a6 };

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const usdBudget = (n: number) => (Number.isInteger(n) ? `$${n}` : usd(n));
export const mins = (n: number) => `${Math.round(n).toLocaleString("en-US")}분`;
export const pct = (used: number, limit: number) => (limit > 0 ? (used / limit) * 100 : 0);
/** 레포 이름의 _ 등이 마크다운으로 해석되지 않게 */
export const esc = (s: string) => s.replace(/[_*~`|>\\]/g, "\\$&");
export const monthLabel = (month: string) => `${Number(month.slice(5))}월`;

/** 막대 모양(src/png.ts)을 바꾸면 올린다. 디스코드가 URL 단위로 이미지를 캐시하기 때문 */
const BAR_VERSION = 2;

/** 진행 막대 이미지 URL (src/png.ts가 그림). 같은 값이면 같은 URL이라 디스코드가 캐시한다 */
export const barImage = (env: Env, p: number) => ({
  url: `${env.PUBLIC_URL}/bar.png?p=${Math.max(0, Math.min(p, 100)).toFixed(1)}&v=${BAR_VERSION}`,
});

export const colorFor = (p: number) =>
  p >= 100 ? COLOR.red : p >= 80 ? COLOR.orange : p >= 50 ? COLOR.yellow : COLOR.green;
export const dotFor = (p: number) => (p >= 100 ? "🔴" : p >= 80 ? "🟠" : p >= 50 ? "🟡" : "🟢");

const kstDate = (d: Date) =>
  d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });

export const freeLeft = (snap: Snapshot) => snap.usedMinutes < snap.freeMinutes;

/** 지금 속도가 유지될 때 무료 분이 언제 떨어지는지. 예측하기 이르면 null */
export function freeForecast(snap: Snapshot): string | null {
  const { usedMinutes: used, freeMinutes: free } = snap;
  if (used >= free) return null;
  const now = new Date(snap.syncedAt);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsedDays = (now.getTime() - start) / 864e5;
  if (elapsedDays < 2 || used <= 0) return null;
  const at = now.getTime() + ((free - used) / (used / elapsedDays)) * 864e5;
  return at < end
    ? `이 속도라면 **${kstDate(new Date(at))}쯤 소진**될 것으로 예상됩니다.`
    : "이 속도라면 월말까지 여유가 있습니다.";
}

/** 이번 달에 실제로 쓴 레포 */
const active = (r: RepoStat) => r.minutes > 0 || r.net > 0;
/** 이번 달엔 안 썼지만 예산 없이 워크플로가 있어 튈 수 있는 레포 */
const idleUnbudgeted = (r: RepoStat) => !active(r) && r.budget === null && (r.workflows ?? 0) > 0;

/** 무료 분 대비 비율. 1% 미만은 "<1%" */
function share(minutes: number, snap: Snapshot) {
  const p = pct(minutes, snap.freeMinutes);
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/**
 * 무료 분이 남아 있으면 예산이 차감되지 않으므로 실행 분만,
 * 무료 분이 떨어진 뒤에는 예산 대비 청구액을 보여 준다. 표시는 문제가 있을 때만 붙인다.
 */
export function repoLine(r: RepoStat, snap: Snapshot): string {
  const name = esc(r.name);
  if (r.budget === null) {
    const paid = r.net > 0 ? ` · ${usd(r.net)} 과금` : "";
    return `⚠️ ${name} · ${mins(r.minutes)} · 예산 없음${paid}`;
  }
  if (freeLeft(snap) && r.net === 0) return `🟢 ${name} · ${mins(r.minutes)}`;
  const p = pct(r.net, r.budget);
  const stopped = p >= 100 && r.stop ? " · **정지됨**" : "";
  return `${dotFor(p)} ${name} · 예산 ${Math.floor(p)}%${stopped}`;
}

export function groupByTeam(snap: Snapshot, teams: Map<string, string>) {
  const groups = new Map<string, RepoStat[]>();
  for (const r of snap.repos.filter(active)) {
    const team = teams.get(r.name) ?? UNASSIGNED;
    groups.set(team, [...(groups.get(team) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([team, repos]) => ({
      team,
      repos: repos.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
      minutes: repos.reduce((a, r) => a + r.minutes, 0),
      net: repos.reduce((a, r) => a + r.net, 0),
    }))
    .sort((a, b) => Number(a.team === UNASSIGNED) - Number(b.team === UNASSIGNED) || b.minutes - a.minutes);
}

function frame(env: Env, snap: Snapshot): Pick<Embed, "footer" | "timestamp" | "url"> {
  return { url: budgetsUrl(env), footer: { text: "GitHub 데이터는 몇 시간 늦게 반영됩니다" }, timestamp: snap.syncedAt };
}

// 디스코드 마크다운 크기: "## " 큰 제목 > "### " 소제목 > 본문 > "-# " 작은 글씨
const lines = (...ls: (string | null | false | undefined)[]) =>
  ls.filter((l) => l !== null && l !== false && l !== undefined).join("\n");

function freeSummary(snap: Snapshot) {
  const p = pct(snap.usedMinutes, snap.freeMinutes);
  return lines(
    `## ${mins(snap.usedMinutes)} / ${mins(snap.freeMinutes)} · ${Math.floor(p)}%`,
    freeLeft(snap) ? freeForecast(snap) : "**무료 분을 모두 소진했습니다.** 지금부터 레포 예산에서 차감됩니다.",
  );
}

const nameList = (repos: string[]) => repos.map(esc).join(", ");

/**
 * 임베드 이미지는 항상 임베드 맨 아래에 붙는다. 막대를 숫자 바로 밑에 두려고
 * 요약(숫자 + 막대)과 TF별 목록을 임베드 두 개로 나눈다.
 */
export function overviewEmbeds(env: Env, snap: Snapshot, teams: Map<string, string>): Embed[] {
  const p = pct(snap.usedMinutes, snap.freeMinutes);
  const sections = groupByTeam(snap, teams).map((g) =>
    lines(
      `### ${g.team} · ${mins(g.minutes)} (${share(g.minutes, snap)})`,
      ...g.repos.map((r) => repoLine(r, snap)),
    ),
  );
  const idle = snap.repos.filter(idleUnbudgeted).map((r) => r.name);
  const color = colorFor(p);
  return [
    {
      title: `${monthLabel(snap.month)} GitHub Actions 사용량`,
      url: budgetsUrl(env),
      description: freeSummary(snap),
      image: barImage(env, p),
      color,
    },
    {
      description: lines(
        ...sections,
        idle.length > 0 && `\n⚠️ **예산 없음** (이번 달 미사용)\n-# ${nameList(idle)}`,
      ).slice(0, 4096) || "이번 달 사용 기록이 아직 없습니다.",
      color,
      footer: frame(env, snap).footer,
      timestamp: snap.syncedAt,
    },
  ];
}

export function teamEmbed(env: Env, snap: Snapshot, teams: Map<string, string>, team: string): Embed | null {
  const members = new Set([...teams.entries()].filter(([, t]) => t === team).map(([r]) => r));
  const stats = snap.repos.filter((r) => (teams.get(r.name) ?? UNASSIGNED) === team);
  if (members.size === 0 && stats.length === 0) return null;
  const used = stats.filter(active).sort((a, b) => b.minutes - a.minutes);
  const idle = stats.filter(idleUnbudgeted).map((r) => r.name);
  const shown = new Set([...used.map((r) => r.name), ...idle]);
  const quiet = [...new Set([...members, ...stats.map((r) => r.name)])].filter((r) => !shown.has(r)).sort();
  const minutes = used.reduce((a, r) => a + r.minutes, 0);
  const net = used.reduce((a, r) => a + r.net, 0);
  const worst = Math.max(0, ...used.map((r) => (r.budget ? pct(r.net, r.budget) : 0)));
  return {
    title: `${team} · ${monthLabel(snap.month)}`,
    description: lines(
      `## ${mins(minutes)}`,
      `무료 분의 ${share(minutes, snap)}`,
      "",
      ...used.map((r) => repoLine(r, snap)),
      idle.length > 0 && `⚠️ **예산 없음** (미사용) · ${nameList(idle)}`,
      quiet.length > 0 && `-# 이번 달 미사용: ${nameList(quiet)}`,
    ).slice(0, 4096),
    color: colorFor(worst),
    ...frame(env, snap),
  };
}

export function repoEmbed(env: Env, snap: Snapshot, teams: Map<string, string>, name: string): Embed | null {
  const r = snap.repos.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!r) return null;
  const p = r.budget ? pct(r.net, r.budget) : 0;
  let budget: string;
  let image: Embed["image"];
  if (r.budget === null) {
    budget = lines("⚠️ **없음**", "-# 무료 분이 떨어지면 제한 없이 과금됩니다");
  } else if (freeLeft(snap) && r.net === 0) {
    budget = lines(usdBudget(r.budget), "-# 무료 분이 떨어지면 차감이 시작됩니다");
  } else {
    budget = lines(
      `${usd(r.net)} / ${usdBudget(r.budget)} · ${Math.floor(p)}%`,
      p >= 100 && (r.stop ? "**Actions 정지됨**" : "-# 초과했지만 정지 설정이 꺼져 있습니다"),
    );
    image = barImage(env, p);
  }
  return {
    title: `${r.name} · ${monthLabel(snap.month)}`,
    description: lines(
      `## ${mins(r.minutes)}`,
      `무료 분의 ${share(r.minutes, snap)}`,
      "### 예산",
      budget,
      r.budget === null && !!r.workflows && `-# 워크플로 ${r.workflows}개`,
    ),
    color: r.budget === null ? COLOR.gray : colorFor(p),
    image,
    ...frame(env, snap),
  };
}

/** /usage 드롭다운용 TF 목록: 이번 달 많이 쓴 순, 안 쓴 TF는 뒤에 */
export function teamOptions(snap: Snapshot, teams: Map<string, string>) {
  const used = groupByTeam(snap, teams);
  const idle = [...new Set(teams.values())].filter((t) => !used.some((g) => g.team === t)).sort();
  return [
    ...used.map((g) => ({
      label: g.team,
      value: g.team,
      description: `${mins(g.minutes)} · 무료 분의 ${share(g.minutes, snap)}`,
    })),
    ...idle.map((t) => ({ label: t, value: t, description: "이번 달 미사용" })),
  ];
}

/** /team list: TF별 배정 레포. 배정 안 된 활성 private 레포는 미배정으로 */
export function teamListEmbed(snap: Snapshot | null, teams: Map<string, string>): Embed {
  const byTeam = new Map<string, string[]>();
  for (const [repo, team] of teams) byTeam.set(team, [...(byTeam.get(team) ?? []), repo]);
  const unassigned = (snap?.repos ?? [])
    .filter((r) => !r.archived && !teams.has(r.name))
    .map((r) => r.name);
  const sections = [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .map(([team, repos]) => lines(`### ${team} · ${repos.length}개`, `-# ${nameList(repos.sort())}`));
  return {
    title: "TF 목록",
    description: lines(
      ...sections,
      unassigned.length > 0 && lines(`### ${UNASSIGNED} · ${unassigned.length}개`, `-# ${nameList(unassigned.sort())}`),
      "",
      "-# 배정은 운영진이 `/team assign`으로 바꿀 수 있습니다",
    ).slice(0, 4096),
    color: COLOR.gray,
  };
}
