// 디스코드 슬래시 명령 정의. scripts/register-commands.ts가 이 파일을 그대로 등록한다.
const SUB_COMMAND = 1;
const STRING = 3;

export const commands = [
  {
    name: "usage",
    description: "GitHub Actions 사용량과 예산 현황을 봅니다",
  },
  {
    name: "subscribe",
    description: "알림을 구독하거나 해제합니다 (다시 쓰면 해제)",
    options: [
      { type: SUB_COMMAND, name: "list", description: "내 구독을 봅니다" },
      { type: SUB_COMMAND, name: "all", description: "전체 사용량(무료 분) 알림 구독/해제" },
      {
        type: SUB_COMMAND,
        name: "repo",
        description: "레포 알림 구독/해제",
        options: [{ type: STRING, name: "repo", description: "레포", required: true, autocomplete: true }],
      },
    ],
  },
  {
    name: "sync",
    description: "GitHub에서 사용량을 지금 다시 가져옵니다",
  },
];
