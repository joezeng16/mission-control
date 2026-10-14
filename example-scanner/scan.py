"""Example scanner for Options Desk: a template to replace with your own.

It writes FICTIONAL signals in the CSV format Options Desk reads (see the README, "Signals CSV format"). Nothing here
is real market data and nothing here is a trading rule: the tickers are real symbols, but every price, date, win rate
and option quote is made up (prices come from a fixed table and a toy Black-Scholes model). Standard library only, no
network access.

Usage:  python scan.py [days_back]     (Options Desk runs it as `python scan.py 5` from this folder)
Output: scans/signals_scan_YYYY-MM-DD_HHMM.csv and scans/signals_exits_YYYY-MM-DD_HHMM.csv (New York time in the name)
"""
from __future__ import annotations

import csv
import math
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

VERSION = 'Example scanner 1.0'
HERE = Path(__file__).resolve().parent
SCANS = HERE / 'scans'
TAKE_PROFIT_LEFT = 0.5   # buy back at 50% of the credit (Options Desk's documented default)
RATE = 0.04

SCAN_COLUMNS = [
    'ticker', 'level', 'kind', 'date', 'days_ago', 'price_then', 'price_now', 'won_pct', 'trades', 'next_earn',
    'borderline', 'detail', 'put_exp', 'put_strike', 'put_bid', 'put_ask', 'put_mid', 'put_spread', 'put_delta',
    'put_note', 'put_wing_strike', 'put_wing_mid', 'put_credit', 'put_width', 'put_buyback', 'put_live',
    'tested_won', 'tested_avg', 'tested_spread_won', 'tested_spread_mid', 'tested_spread_natural', 'scanner',
]
EXIT_COLUMNS = ['ticker', 'level', 'enter', 'enter_price', 'tag', 'date', 'days_ago', 'price', 'move', 'forming']

# Fictional starting prices and volatilities (not quotes).
TICKERS = {
    'AAPL': (210.0, 0.26), 'MSFT': (400.0, 0.24), 'NVDA': (120.0, 0.48), 'AMZN': (185.0, 0.32),
    'GOOGL': (160.0, 0.30), 'META': (580.0, 0.36), 'JPM': (240.0, 0.22), 'KO': (68.0, 0.17),
}

# The sample hits: (ticker, level 1-3, kind, trading days ago, borderline, detail).
HITS = [
    ('NVDA', 3, 'tagged', 1, False, ''),
    ('AAPL', 2, 'tagged', 2, False, ''),
    ('AMZN', 1, 'tagged', 3, True, 'Rule B right at its threshold (example)'),
    ('KO', 1, 'tagged', 1, False, ''),
    ('MSFT', 2, 'forming', 0, False, ''),
    ('GOOGL', 3, 'near', 0, False, 'One rule missed by a little (example)'),
]
# The sample exits: (ticker, level, tag, trading days ago of the exit, calendar days held, move).
EXITS = [
    ('JPM', 1, 'TP', 1, 28, 0.048),
    ('META', 2, 'TP', 0, 22, 0.052),
    ('KO', 1, 'STOP LOSS', 2, 34, -0.091),
    ('MSFT', 2, 'TIME', 3, 45, 0.013),
]
# Delta the example aims for at each level (the same defaults Options Desk documents).
LEVEL_DELTA = {3: 0.30, 2: 0.20, 1: 0.15}
WING_DELTA = 0.10


def new_york_now() -> datetime:
    """New York wall-clock time. zoneinfo needs the tzdata package on Windows, so US Eastern rules are the fallback."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo('America/New_York')).replace(tzinfo=None)
    except Exception:
        utc = datetime.now(timezone.utc).replace(tzinfo=None)
        year = utc.year
        march = date(year, 3, 1)
        dst_start = datetime.combine(march + timedelta(days=(6 - march.weekday()) % 7 + 7), datetime.min.time()) + timedelta(hours=7)
        november = date(year, 11, 1)
        dst_end = datetime.combine(november + timedelta(days=(6 - november.weekday()) % 7), datetime.min.time()) + timedelta(hours=6)
        return utc - timedelta(hours=4 if dst_start <= utc < dst_end else 5)


def trading_days(end: date, count: int) -> list[date]:
    """The last `count` weekdays up to `end` (newest first). Holidays are ignored: this is an example."""
    days: list[date] = []
    d = end
    while len(days) < count:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return days


def third_friday(year: int, month: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(4 - first.weekday()) % 7 + 14)


def expiry_after(today: date, min_days: int = 30) -> date:
    """The first monthly (third Friday) expiration at least `min_days` away."""
    year, month = today.year, today.month
    while True:
        exp = third_friday(year, month)
        if (exp - today).days >= min_days:
            return exp
        month = 1 if month == 12 else month + 1
        year += 1 if month == 1 else 0


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def put_value(spot: float, strike: float, years: float, iv: float) -> tuple[float, float]:
    """Toy Black-Scholes put: (price, delta)."""
    sq = iv * math.sqrt(years)
    d1 = (math.log(spot / strike) + (RATE + iv * iv / 2) * years) / sq
    d2 = d1 - sq
    price = strike * math.exp(-RATE * years) * norm_cdf(-d2) - spot * norm_cdf(-d1)
    return max(price, 0.01), norm_cdf(d1) - 1.0


def strike_step(spot: float) -> float:
    return 1.0 if spot < 100 else 2.5 if spot < 200 else 5.0 if spot < 500 else 10.0


def strike_for_delta(spot: float, years: float, iv: float, target: float, below: float | None = None) -> float:
    """The listed-looking strike whose put delta is closest to -target (and under `below` when given)."""
    step = strike_step(spot)
    best, best_gap = None, None
    k = math.floor(spot / step) * step
    while k > spot * 0.5:
        if below is None or k < below:
            gap = abs(abs(put_value(spot, k, years, iv)[1]) - target)
            if best_gap is None or gap < best_gap:
                best, best_gap = k, gap
        k -= step
    return best if best is not None else round(spot * 0.8)


def quote(mid: float, rng: random.Random) -> tuple[float, float, float]:
    """A made-up bid / ask around a model mid: (bid, ask, mid)."""
    half = max(0.01, mid * rng.uniform(0.02, 0.06))
    bid, ask = round(max(mid - half, 0.01), 2), round(mid + half, 2)
    return bid, ask, round((bid + ask) / 2, 4)


def money(x: float) -> str:
    return f'{x:.2f}'


def signal_row(hit: tuple, days: list[date], today: date, exp: date, rng: random.Random) -> dict[str, str]:
    ticker, level, kind, ago, borderline, detail = hit
    base, iv = TICKERS[ticker]
    price_now = round(base * rng.uniform(0.97, 1.03), 2)
    price_then = price_now if kind != 'tagged' else round(price_now * rng.uniform(0.97, 1.03), 2)
    years = max((exp - today).days, 1) / 365
    strike = strike_for_delta(price_now, years, iv, LEVEL_DELTA[level])
    bid, ask, mid = quote(put_value(price_now, strike, years, iv)[0], rng)
    delta = put_value(price_now, strike, years, iv)[1]
    row = {c: '' for c in SCAN_COLUMNS}
    row.update({
        'ticker': ticker, 'level': f'{level}/3', 'kind': kind, 'date': days[ago].isoformat(),
        'days_ago': str(ago), 'price_then': money(price_then), 'price_now': money(price_now),
        'won_pct': f'{rng.uniform(80, 98):.1f}', 'trades': str(rng.randint(8, 30)),
        'next_earn': (today + timedelta(days=rng.randint(10, 70))).isoformat(),
        'borderline': 'True' if borderline else 'False', 'detail': detail,
        'put_exp': exp.isoformat(), 'put_strike': f'{strike:g}', 'put_bid': money(bid), 'put_ask': money(ask),
        'put_mid': f'{mid:.4f}', 'put_spread': f'{(ask - bid) / mid:.4f}', 'put_delta': f'{delta:.4f}',
        'put_live': 'True', 'scanner': VERSION,
    })
    if ticker == 'KO':   # one row without a wing: shown as a cash-secured put
        row['put_buyback'] = f'{mid * TAKE_PROFIT_LEFT:.4f}'
        return row
    wing = strike_for_delta(price_now, years, iv, WING_DELTA, below=strike)
    _, _, wing_mid = quote(put_value(price_now, wing, years, iv)[0], rng)
    credit = mid - wing_mid
    row.update({
        'put_wing_strike': f'{wing:g}', 'put_wing_mid': f'{wing_mid:.4f}', 'put_credit': f'{credit:.4f}',
        'put_width': f'{strike - wing:g}', 'put_buyback': f'{credit * TAKE_PROFIT_LEFT:.4f}',
    })
    return row


def exit_row(spec: tuple, days: list[date], rng: random.Random) -> dict[str, str]:
    ticker, level, tag, ago, held, move = spec
    price = round(TICKERS[ticker][0] * rng.uniform(0.97, 1.03), 2)
    enter_price = round(price / (1 + move), 2)
    exit_day = days[ago]
    return {
        'ticker': ticker, 'level': f'{level}/3', 'enter': (exit_day - timedelta(days=held)).isoformat(),
        'enter_price': money(enter_price), 'tag': tag, 'date': exit_day.isoformat(),
        'days_ago': str(-1 if ago == 0 else ago), 'price': money(price), 'move': f'{price / enter_price - 1:.6f}',
        'forming': 'True' if ago == 0 else 'False',
    }


def write_csv(path: Path, columns: list[str], rows: list[dict[str, str]]) -> None:
    """Writes next to the target, then renames: Options Desk never sees a half-written file."""
    tmp = path.with_suffix('.csv.tmp')
    with tmp.open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, path)


def parse_days_back(argv: list[str]) -> int:
    if len(argv) < 2:
        return 5
    try:
        n = int(argv[1])
    except ValueError:
        raise SystemExit(f'days_back must be a whole number, got {argv[1]!r}')
    if not 1 <= n <= 30:
        raise SystemExit(f'days_back must be between 1 and 30, got {n}')
    return n


def main(argv: list[str]) -> int:
    days_back = parse_days_back(argv)
    now = new_york_now()
    today = now.date()
    days = trading_days(today, max(days_back, 4))
    rng = random.Random(today.isoformat())
    print(f'{VERSION}: {len(TICKERS)} fictional tickers, last {days_back} trading days', flush=True)
    print('Checking the example rules on every ticker...', flush=True)
    hits = [h for h in HITS if h[3] < days_back]
    print(f'Hits: {sum(h[2] == "tagged" for h in hits)} tagged, {sum(h[2] == "forming" for h in hits)} forming, '
          f'{sum(h[2] == "near" for h in hits)} near miss', flush=True)
    exp = expiry_after(today)
    print(f'Pricing puts for {exp:%b %d} with a toy model (fictional numbers)...', flush=True)
    signals = [signal_row(h, days, today, exp, rng) for h in hits]
    exits = [exit_row(e, days, rng) for e in EXITS if e[3] < days_back]
    print('Too new for the scanner (1): NEWCO', flush=True)
    SCANS.mkdir(exist_ok=True)
    stamp = now.strftime('%Y-%m-%d_%H%M')
    scan_file = SCANS / f'signals_scan_{stamp}.csv'
    exits_file = SCANS / f'signals_exits_{stamp}.csv'
    write_csv(exits_file, EXIT_COLUMNS, exits)
    write_csv(scan_file, SCAN_COLUMNS, signals)   # the scan file last: its name is what Options Desk looks for
    print(f'Saved scans/{scan_file.name} and scans/{exits_file.name}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
