export interface Env {
  DB: D1Database;
  GITHUB_ORG: string;
  /** 이 Worker의 공개 URL (막대 이미지 주소에 씀) */
  PUBLIC_URL: string;
  FREE_MINUTES: string;
  ALERT_THRESHOLDS: string;
  ALERT_CHANNEL_ID: string;
  ALERT_MENTION_ROLE_ID: string;
  /** 중요한 알림 때 레포 파트에 따라 태그할 역할 */
  FRONTEND_ROLE_ID: string;
  BACKEND_ROLE_ID: string;
  ADMIN_ROLE_ID: string;
  /** 수집 실패 알림 때 멘션할 사용자 ID (봇 관리자) */
  FAILURE_MENTION_USER_ID: string;
  // secrets
  GITHUB_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
  DISCORD_BOT_TOKEN: string;
}

export interface RepoStat {
  name: string;
  /** 이번 달 Actions 실행 분 */
  minutes: number;
  /** 무료 분 적용 전 금액 (USD) */
  gross: number;
  /** 실제 청구 금액 = 예산에서 차감되는 금액 (USD) */
  net: number;
  /** GitHub 레포 예산 (USD). 없으면 null */
  budget: number | null;
  /** 예산 도달 시 사용 중지 여부 */
  stop: boolean | null;
  /** 아카이브된 레포 (Actions는 못 돌지만 예전 artifact 스토리지 요금이 잡힐 수 있음) */
  archived?: boolean;
  /** 워크플로 개수. 예산 없는 활성 private 레포만 확인, 나머지는 null */
  workflows: number | null;
}

export interface Snapshot {
  /** YYYY-MM (UTC, GitHub 청구 주기 기준) */
  month: string;
  syncedAt: string;
  freeMinutes: number;
  usedMinutes: number;
  net: number;
  repos: RepoStat[];
}
