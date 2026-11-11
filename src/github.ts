import type { Env } from "./types.ts";

async function gh<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "actions-quota-bot",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface UsageItem {
  date: string;
  product: string;
  sku: string;
  quantity: number;
  unitType: string;
  grossAmount: number;
  netAmount: number;
  repositoryName?: string;
}

export async function fetchUsage(env: Env, year: number, month: number): Promise<UsageItem[]> {
  const r = await gh<{ usageItems?: UsageItem[] }>(
    env,
    `/organizations/${env.GITHUB_ORG}/settings/billing/usage?year=${year}&month=${month}`,
  );
  return r.usageItems ?? [];
}

export interface Budget {
  budget_type: string;
  budget_product_sku: string;
  budget_scope: string;
  budget_amount: number;
  prevent_further_usage: boolean;
  budget_entity_name: string;
}

export async function fetchBudgets(env: Env): Promise<Budget[]> {
  const r = await gh<{ budgets?: Budget[] }>(env, `/organizations/${env.GITHUB_ORG}/settings/billing/budgets`);
  return r.budgets ?? [];
}

export interface Repo {
  name: string;
  private: boolean;
  archived: boolean;
}

export async function fetchRepos(env: Env): Promise<Repo[]> {
  const out: Repo[] = [];
  for (let page = 1; ; page++) {
    const batch = await gh<Repo[]>(env, `/orgs/${env.GITHUB_ORG}/repos?type=all&per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

export async function countWorkflows(env: Env, repo: string): Promise<number> {
  const r = await gh<{ total_count: number }>(env, `/repos/${env.GITHUB_ORG}/${repo}/actions/workflows?per_page=1`);
  return r.total_count;
}

export const budgetsUrl = (env: Env) =>
  `https://github.com/organizations/${env.GITHUB_ORG}/settings/billing/budgets`;

export const actionsUrl = (env: Env, repo: string) => `https://github.com/${env.GITHUB_ORG}/${repo}/actions`;
