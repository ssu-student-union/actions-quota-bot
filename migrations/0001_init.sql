-- 레포 → TF 매핑 (표시·그룹용. 한도는 GitHub 예산에서 읽어 옴)
CREATE TABLE repo_team (
  repo TEXT PRIMARY KEY,
  team TEXT NOT NULL
);

-- 이미 보낸 알림. month='once'는 달이 바뀌어도 다시 보내지 않는 알림
CREATE TABLE alerts (
  month TEXT NOT NULL,
  scope TEXT NOT NULL,
  level INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (month, scope, level)
);

-- 최근 수집 결과 등
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO repo_team (repo, team) VALUES
  ('ssuport-frontend', 'SSUport'),
  ('ssuport-backend', 'SSUport'),
  ('student-club-homepage-frontend', '동아리연합회 홈페이지'),
  ('student-club-homepage-backend', '동아리연합회 홈페이지'),
  ('student-club-homepage-db-migration', '동아리연합회 홈페이지'),
  ('PASSU_Backend_V3', 'PASSU'),
  ('PASSU_Backend', 'PASSU'),
  ('PASSU_Admin_Backend', 'PASSU'),
  ('passu-frontend-admin', 'PASSU'),
  ('passu-frontend-user', 'PASSU'),
  ('passu-release-bot', 'PASSU'),
  ('passu-ui', 'PASSU'),
  ('ssu-it-landing', 'IT지원위원회 홈페이지'),
  ('homepage-frontend', '총학생회 홈페이지'),
  ('homepage-backend', '총학생회 홈페이지'),
  ('itsupport-auth', 'SSO'),
  ('itsupport-aws', '공통/인프라'),
  ('itsupport-aws-instance-manager', '공통/인프라'),
  ('itsupport-monitoring', '공통/인프라'),
  ('itsupport-ssm-logcleaner', '공통/인프라');
