-- 개인 알림 구독: 이 대상에 해당하는 레포 알림이 나가면 그 사람을 멘션한다
-- kind: repo(레포 이름) / team(TF 이름) / part(frontend·backend)
CREATE TABLE subscriptions (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('repo', 'team', 'part')),
  target TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, target)
);
