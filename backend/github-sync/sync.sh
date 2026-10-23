#!/bin/bash
# 随手存仓库 <-> GitHub 自动同步（零 token 脚本）
# 逻辑：fetch -> 本地有改动就提交 -> rebase 到远程最新 -> push；本地干净且远程领先则快进拉取。
# 冲突时中止 rebase 并记日志，不自动裁决。
REPO=/home/hatch/workspace/projects/douyin-direct-downloader
LOG=/home/hatch/workspace/services/github-sync/sync.log
exec 9>/tmp/github-sync.lock
flock -n 9 || exit 0
cd "$REPO" || exit 1
ts() { date '+%F %T %z'; }
git fetch origin main --quiet || { echo "$(ts) fetch FAILED" >> "$LOG"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
CHANGED=0
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit --quiet -m "auto-sync $(date '+%F %T')" && CHANGED=1
  LOCAL=$(git rev-parse HEAD)
fi
if [ "$LOCAL" != "$REMOTE" ]; then
  if git merge-base --is-ancestor "$LOCAL" "$REMOTE" && [ $CHANGED = 0 ]; then
    git merge --ff-only origin/main --quiet && echo "$(ts) pulled $(git rev-parse --short HEAD)" >> "$LOG"
  else
    if git rebase origin/main --quiet 2>/dev/null; then
      git push origin main --quiet && echo "$(ts) pushed $(git rev-parse --short HEAD)" >> "$LOG" || echo "$(ts) push FAILED" >> "$LOG"
    else
      git rebase --abort
      echo "$(ts) CONFLICT: rebase failed, manual resolution needed" >> "$LOG"
      exit 2
    fi
  fi
fi
exit 0
