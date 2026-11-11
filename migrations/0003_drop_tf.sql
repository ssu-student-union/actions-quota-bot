-- TF 개념 제거, 구독은 전체 사용량(org) / 레포(repo) 두 가지만 남긴다.
-- SQLite는 CHECK를 바꿀 수 없어 구독 테이블을 다시 만든다 (기존 레포 구독은 유지).
CREATE TABLE subscriptions_new (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('org', 'repo')),
  target TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, target)
);
INSERT INTO subscriptions_new SELECT user_id, kind, target FROM subscriptions WHERE kind = 'repo';
DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

DROP TABLE repo_team;
