# actions-quota-bot

GitHub Actions 사용량을 레포별 **GitHub 예산(Budget)**과 비교해 디스코드로 알려 주는 봇입니다.
Cloudflare Workers에서 매시 정각에 돌고, 한도는 GitHub Billing → Budgets 값을 그대로 읽습니다.

## 알림

- 무료 분 50 / 80 / 100%
- 레포 예산 50 / 80 / 100% (100% = Actions 정지)
- 예산 없는 레포 발견 · 예산 없는 레포 과금
- 수집 실패 (봇 관리자 멘션)

**구독한 사람만 멘션됩니다.** 무료 분 알림은 "전체 사용량" 구독자, 레포 알림은 그 레포 구독자에게 갑니다.

## 명령

응답은 모두 본인에게만 보입니다.

| 명령 | 설명 |
|---|---|
| `/usage` | 사용량 현황 (드롭다운으로 레포 상세) |
| `/sync` | 지금 다시 수집 |
| `/subscribe all` · `repo` · `list` | 전체 사용량·레포 구독 (다시 쓰면 해제). 알림과 `/usage`의 🔔 버튼으로도 가능 |

## 배포

`main`에 push하면 GitHub Actions가 배포합니다 (public 레포라 무료).
GitHub secret: `CLOUDFLARE_API_TOKEN` (Workers + D1 Edit).

명령 정의(`src/definitions.ts`)를 바꾸면 `pnpm register`를 직접 실행합니다.

### 처음 설정

```sh
pnpm exec wrangler d1 create actions-quota-bot   # database_id → wrangler.jsonc
pnpm exec wrangler secret put GITHUB_TOKEN       # org 관리자의 fine-grained PAT (Administration·Actions: Read)
pnpm exec wrangler secret put DISCORD_APP_ID
pnpm exec wrangler secret put DISCORD_PUBLIC_KEY
pnpm exec wrangler secret put DISCORD_BOT_TOKEN
```

디스코드 Developer Portal의 Interactions Endpoint URL에 Worker URL을 넣습니다. 채널 ID 등은 `wrangler.jsonc`의 `vars`에 있습니다.
