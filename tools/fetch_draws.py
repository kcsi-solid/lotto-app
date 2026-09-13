#!/usr/bin/env python3
"""
fetch_draws.py — 회차 데이터를 내려받아 data/draws.json 으로 저장한다.

두 개의 소스를 순서대로 시도한다.
  1) 공개 미러 (기본)  : 키가 필요 없고 안정적이다.
  2) 동행복권 공식 API : 봇 차단(NetFUNNEL 대기열)이 걸려 있어 대부분 실패한다.
                         실패하면 tools/collect-in-browser.js 를 쓰라고 안내한다.

사용법
    python tools/fetch_draws.py                 # 전체 갱신
    python tools/fetch_draws.py --since 1200    # 1200회부터만
    python tools/fetch_draws.py --source official
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

# Windows 기본 콘솔(cp949)에서 한글 메시지가 깨지지 않게 한다.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "draws.json")

MIRROR = "https://smok95.github.io/lotto/results/{draw}.json"
MIRROR_ALL = "https://smok95.github.io/lotto/results/all.json"
OFFICIAL = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={draw}"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def normalize(o):
    """여러 응답 모양을 [drwNo, date, n1..n6, bonus] 한 줄로 맞춘다."""
    if not isinstance(o, dict):
        return None
    no = o.get("draw_no") or o.get("drwNo")
    nums = o.get("numbers")
    if nums is None:
        nums = [o.get(f"drwtNo{i}") for i in range(1, 7)]
    bonus = o.get("bonus_no") if o.get("bonus_no") is not None else o.get("bnusNo")
    date = str(o.get("date") or o.get("drwNoDate") or "")[:10]

    if not isinstance(no, int):
        return None
    if not isinstance(nums, list) or len(nums) != 6:
        return None
    try:
        nums = [int(n) for n in nums]
        bonus = int(bonus)
    except (TypeError, ValueError):
        return None
    if len(set(nums)) != 6 or any(not 1 <= n <= 45 for n in nums):
        return None
    if not 1 <= bonus <= 45:
        return None
    return [no, date, *sorted(nums), bonus]


def fetch_range(template, start, end, workers=8):
    def one(n):
        try:
            return normalize(get_json(template.format(draw=n)))
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError):
            return None

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return [r for r in ex.map(one, range(start, end + 1)) if r]


def find_latest(template, lo=1, hi=4000):
    """이분 탐색으로 최신 회차를 찾는다."""
    def exists(n):
        try:
            return normalize(get_json(template.format(draw=n))) is not None
        except Exception:
            return False

    if not exists(lo):
        return 0
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if exists(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["mirror", "official"], default="mirror")
    ap.add_argument("--since", type=int, default=1)
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    template = MIRROR if args.source == "mirror" else OFFICIAL
    label = ("smok95.github.io/lotto (동행복권 공식 회차 데이터 미러)"
             if args.source == "mirror" else "동행복권 dhlottery.co.kr")

    rows = []
    if args.source == "mirror" and args.since <= 1:
        try:
            print("전체 데이터를 한 번에 받는 중…")
            rows = [r for r in (normalize(o) for o in get_json(MIRROR_ALL, timeout=90)) if r]
        except Exception as e:
            print(f"일괄 수신 실패({e}). 회차별로 받습니다.")

    if not rows:
        print("최신 회차 탐색 중…")
        latest = find_latest(template)
        if latest == 0:
            print("\n[실패] 이 네트워크에서 데이터 소스에 접근할 수 없습니다.", file=sys.stderr)
            if args.source == "official":
                print("동행복권은 봇 차단(대기열)이 걸려 있습니다.", file=sys.stderr)
                print("크롬에서 dhlottery.co.kr 을 연 뒤 개발자도구 콘솔에", file=sys.stderr)
                print("tools/collect-in-browser.js 를 붙여넣어 수집하세요.", file=sys.stderr)
            return 1
        print(f"최신 회차 = {latest}. {args.since}회부터 받습니다.")
        rows = fetch_range(template, args.since, latest)

    # 기존 파일과 병합 (--since 로 일부만 받았을 때를 위해)
    existing = None
    if os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                existing = json.load(f)
            rows = existing.get("draws", []) + rows
        except (OSError, json.JSONDecodeError):
            existing = None

    merged = {r[0]: r for r in rows}
    draws = [merged[k] for k in sorted(merged)]
    if not draws:
        print("[실패] 유효한 회차가 없습니다.", file=sys.stderr)
        return 1

    nos = [d[0] for d in draws]
    gaps = [n for n in range(nos[0], nos[-1] + 1) if n not in merged]
    if gaps:
        print(f"[경고] 빠진 회차 {len(gaps)}개: {gaps[:20]}")

    # 회차 데이터가 그대로면 파일을 건드리지 않는다.
    # 매번 fetchedAt 만 바뀌어 저장하면 git 이 늘 "변경됨"으로 보고,
    # 자동 갱신 워크플로가 새 회차도 없이 매주 빈 커밋을 만들게 된다.
    if existing is not None and existing.get("draws") == draws:
        print(f"변경 없음: 이미 최신입니다 ({len(draws)}회차, 1~{nos[-1]})")
        return 0

    out = {
        "schema": "lotto-draws/1",
        "source": label,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "numbers are stored ASCENDING; the physical ball draw order is not published.",
        "fields": ["drwNo", "date", "n1", "n2", "n3", "n4", "n5", "n6", "bonus"],
        "latest": nos[-1],
        "count": len(draws),
        "draws": draws,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {args.out}  ({len(draws)}회차, 1~{nos[-1]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
