// 디스코드 슬래시 명령 정의. scripts/register-commands.ts가 이 파일을 그대로 등록한다.
const SUB_COMMAND = 1;
const STRING = 3;

const repoOption = (description: string, required = true) => ({
  type: STRING,
  name: "repo",
  description,
  required,
  autocomplete: true,
});
const teamOption = (name: string, description: string, required = true) => ({
  type: STRING,
  name,
  description,
  required,
  autocomplete: true,
});

export const commands = [
  {
    name: "usage",
    description: "GitHub Actions 사용량과 예산 현황을 봅니다",
    options: [
      teamOption("team", "이 TF의 레포만 보기", false),
      repoOption("이 레포만 자세히 보기", false),
    ],
  },
  {
    name: "team",
    description: "TF와 레포 배정을 관리합니다",
    options: [
      {
        type: SUB_COMMAND,
        name: "list",
        description: "TF별 레포 목록을 봅니다",
      },
      {
        type: SUB_COMMAND,
        name: "assign",
        description: "레포를 TF에 배정합니다 (운영진)",
        options: [repoOption("배정할 레포"), teamOption("team", "TF 이름 (새 이름을 쓰면 새 TF가 생깁니다)")],
      },
      {
        type: SUB_COMMAND,
        name: "unassign",
        description: "레포를 TF에서 뺍니다 (운영진)",
        options: [repoOption("뺄 레포")],
      },
      {
        type: SUB_COMMAND,
        name: "rename",
        description: "TF 이름을 바꿉니다 (운영진)",
        options: [teamOption("team", "지금 이름"), { type: STRING, name: "name", description: "새 이름", required: true }],
      },
    ],
  },
  {
    name: "subscribe",
    description: "레포·TF·파트 알림을 받거나 끕니다 (다시 쓰면 해제)",
    options: [
      { type: SUB_COMMAND, name: "list", description: "내가 구독한 알림을 봅니다" },
      { type: SUB_COMMAND, name: "repo", description: "레포 알림 받기/끄기", options: [repoOption("레포")] },
      { type: SUB_COMMAND, name: "team", description: "TF 알림 받기/끄기", options: [teamOption("team", "TF")] },
      {
        type: SUB_COMMAND,
        name: "part",
        description: "프론트엔드·백엔드 전체 알림 받기/끄기",
        options: [
          {
            type: STRING,
            name: "part",
            description: "파트",
            required: true,
            choices: [
              { name: "프론트엔드", value: "frontend" },
              { name: "백엔드", value: "backend" },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "sync",
    description: "GitHub에서 사용량을 지금 다시 가져옵니다",
  },
];
