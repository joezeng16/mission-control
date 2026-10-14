# Mission Control

A desktop desk for options traders, built with Electron, React and TypeScript. It puts three things in one window:

- **Signals**: runs *your own* scanner script, shows the signals and exits it saved, and suggests a put or put credit
  spread for each signal.
- **TradingView**: the real tradingview.com, signed in with your own account, next to the signals. Click a row and the
  chart switches to that stock.
- **Calculator**: an options profit / loss calculator (cash-secured put, put credit spread, long call / LEAPS, covered
  call) on Yahoo option chains, with a payoff chart, a date slider and the usual stats.

The repo ships an **example scanner** that writes made-up signals, so the app works out of the box. Replace it with your
own scanner: any script that writes the CSV format documented below.

> Not financial advice. See the [disclaimer](#disclaimer).

## Screenshots

_Screenshots coming soon._ To make your own, run the smoke test (see [Tests](#tests)): it saves screenshots of every tab
to `e2e/shots/`.

## Features

- **Run scan** starts your scanner (`python scan.py 5` in your scanner folder), streams its output while it runs, and can
  cancel it. Scans saved outside the app are picked up when the window comes back into focus.
- **Signals table**: level 1/3 to 3/3, price and move since the signal, the suggested put (strike, expiry, mid, bid/ask),
  what one spread collects and can lose, the bid/ask gap, the stock's historical win rate at that level, and the next
  earnings date. Filter by level, sort by any column. Borderline signals and near misses are flagged "Check chart".
- **Exits list**: take-profit, stop-loss and time exits your scanner reports.
- **Clear warnings**: scans run outside market hours (last-trade prices), old scans, missing CSV columns, unreadable rows,
  and the lines your scanner printed about skipped stocks.
- **TradingView pane**: daily, 4-hour, 1-hour and 30-minute charts; your saved chart layout is kept; back, reload and
  open-in-browser buttons. Sign in once; the session is remembered.
- **Calculator**: Black-Scholes pricing, implied volatility from quotes, P/L at expiry and on any date before it, a
  what-if volatility slider, breakevens, max profit / loss, chance of profit (model), return on cash, and a good-till-canceled
  buy-back target. Every signal row has a **Calculate** button that opens that trade, filled in.
- All market times are shown in New York time (ET). Keyboard: Ctrl+1 / Ctrl+2 switch tabs.

## Requirements

- **Node.js 22 or newer** (and npm).
- **Python 3** to run the example scanner (standard library only). Your own scanner can use anything Python can run.
- **Windows 10/11** is the tested platform, and the packaging config builds a Windows installer. Development mode may
  work on macOS and Linux but is untested there.
- An internet connection for TradingView and Yahoo.

## Getting started

```bash
npm install
npm run dev          # the app with hot reload, using example-scanner/ as the scanner folder
npm run dev:web      # the screens alone in a browser with sample data: http://127.0.0.1:5199
```

In the browser preview, `?mock=live` opens the market-hours sample scan, `?tv=out` shows the signed-out TradingView
state, and `?clock=open` / `?clock=closed` move the app clock to 10:30 AM / 7:00 PM ET.

**If the app does not open** and Electron behaves like plain Node, your terminal has `ELECTRON_RUN_AS_NODE` set (some
editors' integrated terminals set it). Clear it for the command:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev                 # bash / Git Bash / macOS / Linux
```

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run dev        # PowerShell
```

The same applies to `npm run build:*` and the Playwright smoke test.

### Build

```bash
npm run build        # typecheck + compile to out/
npm run build:dir    # unpacked Windows app in dist/win-unpacked/MissionControl.exe
npm run build:win    # Windows installer in dist/
```

Close Mission Control before `build:dir` / `build:win`: a running copy can't be replaced (the build script checks).

### Tests

```bash
npm test                         # unit tests (Vitest)
npm run typecheck                # TypeScript, main and renderer
npm run build && npx playwright test e2e   # smoke test of the built app
```

The smoke test launches the built app with a fresh copy of the example scanner, runs a scan, opens the chart and the
calculator, and fails on any error on the app page. It needs Python 3 and an internet connection, and Mission Control
must not be open (the app allows one copy at a time).

## Configuration

| Environment variable | Default | What it does |
| --- | --- | --- |
| `MC_SCANNER_DIR` | development: `<repo>/example-scanner`; installed app: `<home>/MissionControl/scanner` | The folder that holds `scan.py`. Its CSVs go in `scans/` inside it. |
| `MC_PYTHON` | `python` on Windows, `python3` elsewhere (from `PATH`) | Full path to the Python that runs the scanner. |

If the scanner folder or `scan.py` is missing, the Signals tab says so and names the folder it looked in.

Where the app keeps its own data: the settings folder `Mission Control (open source)` under your app-data folder
(`%APPDATA%` on Windows). It holds the TradingView session and a small log, `logs/main.log` (rolled over at 1 MB).

**Trading defaults** live in one file, [`src/shared/defaults.ts`](src/shared/defaults.ts): the put delta per signal level
(3/3: 0.30, 2/3: 0.20, 1/3: 0.15), the delta for a typed ticker (0.30), the spread's bought put (0.10 delta), your
take-profit rule (buy back at 50% of what you collected), the "wide" bid/ask threshold (15% of the mid), how many trading
days the scanner is asked to look back (5), and the trade count under which a win rate is greyed out (10). They are
common conventions, not recommendations: change them to match your own rules.

## Plug in your own scanner

Mission Control does not ship any trading rules. It runs whatever `scan.py` you give it and shows what that script saves.
Start from [`example-scanner/scan.py`](example-scanner/scan.py): it is a self-contained template (standard library, no
network) that writes fictional data in the right format. Because its prices are made up, the strikes it suggests won't
match the real market when you press Calculate; your own scanner fixes that.

The contract:

1. The app runs `python scan.py <days_back>` (`days_back` is 5 by default) with the scanner folder as the working
   directory. Anything you `print` shows up live under the header; print with `flush=True` (the app also sets
   `PYTHONUNBUFFERED=1`).
2. Lines that mention `not scanned`, `no close`, `dropped`, `too new` or `chain unavailable` are kept after the run as
   notes ("The last run skipped or dropped some stocks").
3. Exit with code 0 after writing a **new** `scans/signals_scan_YYYY-MM-DD_HHMM.csv`, stamped with the **New York** time of
   the run. The newest stamp in the file name wins. A non-zero exit, or an exit 0 without a newer file, is shown as a
   failed run together with your script's last output lines.
4. Optionally write `scans/signals_exits_YYYY-MM-DD_HHMM.csv` with the **same** stamp.
5. Write each file under a temporary name and rename it when done, so the app never reads half a file. Write the
   exits file before the scan file.
6. A run is stopped after 15 minutes. Cancel stops your script and everything it started.

You can also run your scanner on a schedule outside the app; the Signals tab re-reads the newest files when it opens and
when the window comes back into focus.

### Signals CSV format

`scans/signals_scan_YYYY-MM-DD_HHMM.csv`, one row per signal, with a header row. Column order does not matter and extra
columns are ignored. Empty cells and `nan`, `none`, `null` read as blank. Booleans are `True` / `1` / `yes`, anything
else is false. Dates are `YYYY-MM-DD` (a trailing time such as `00:00:00` is ignored).

"Required" columns: a row without them is skipped and counted. "Expected" columns: if the file lacks one, the app shows a
warning naming it.

| Column | Need | Example | Meaning |
| --- | --- | --- | --- |
| `ticker` | required | `AAPL` | Symbol, Yahoo style (class shares with a dash: `BRK-B`; the chart converts it). |
| `level` | required | `2/3` | Signal strength 1 to 3, written `N/3` or just `N`. A column named `lv` is accepted instead. |
| `kind` | required | `tagged` | `tagged` (fired on a closed bar), `forming` (may fire at today's close) or `near` (just missed; listed under "Check the chart"). |
| `date` | required | `2026-03-09` | Day the signal fired. |
| `days_ago` | required for `tagged` | `2` | Trading days since the signal (0 = today). Ignored for `forming` and `near`. |
| `price_then` | required | `215.10` | Price on the signal day. |
| `price_now` | required | `212.40` | Latest price. |
| `won_pct` | expected | `95.5` | The stock's historical win rate at this level, in percent. |
| `trades` | expected | `22` | How many trades `won_pct` rests on (under 10 is greyed out). |
| `next_earn` | expected | `2026-04-30` | Next earnings date (highlighted when it comes before the put expires). |
| `borderline` | expected | `False` | `True` = right at the edge of a rule: flagged "Check chart". |
| `detail` | optional | `Rule B right at its threshold` | Why it is borderline or a near miss (tooltip). |
| `put_exp` | expected | `2026-04-17` | Expiration of the suggested put. Without `put_exp` and `put_strike` the row shows "No put found". |
| `put_strike` | expected | `195` | Strike of the put to sell. |
| `put_bid`, `put_ask` | optional | `2.10`, `2.24` | Quote of that put when the scan ran. |
| `put_mid` | expected | `2.17` | Mid price, or the last trade when there was no live quote. |
| `put_spread` | optional | `0.0645` | (ask - bid) / mid as a **fraction**; above `WIDE_SPREAD` it is flagged "wide". |
| `put_delta` | optional | `-0.20` | Delta of the put. |
| `put_note` | optional | `market closed: last trade price` | Free text; a note containing "market closed" or "chain unavailable" gets a plain explanation. |
| `put_wing_strike` | optional | `185` | Strike of the bought put, for a put credit spread. |
| `put_wing_mid` | optional | `0.95` | Mid of the bought put. |
| `put_credit` | optional | `1.22` | Spread credit per share at the mids (`put_mid - put_wing_mid`). |
| `put_width` | optional | `10` | `put_strike - put_wing_strike`. With credit and width the row shows a spread; without, a cash-secured put. |
| `put_buyback` | optional | `0.61` | Good-till-canceled buy-back price per share. Default: `TAKE_PROFIT_LEFT` x `put_mid`. |
| `put_live` | optional | `True` | Whether the quote was a live bid/ask. Default: true when bid and ask are both above 0. Rows without a live quote are greyed out. |
| `tested_won`, `tested_avg` | optional | `80`, `1.5` | Your own backtest of every signal at this level, cash-secured put: percent won, and average profit per trade as a percent of the cash it ties up. Shown as "Scanner backtest" only when present. |
| `tested_spread_won`, `tested_spread_mid`, `tested_spread_natural` | optional | `75`, `6`, `-2` | The same backtest for the credit spread: percent won, average result as a percent of max loss at the mids, and at bid/ask prices. |
| `scanner` | optional | `My scanner 2.1` | Your scanner's name and version, shown next to the title. |

### Exits CSV format

`scans/signals_exits_YYYY-MM-DD_HHMM.csv`, same stamp as the scan file. All columns except `forming` are required.

| Column | Example | Meaning |
| --- | --- | --- |
| `ticker` | `JPM` | Symbol. |
| `level` | `1/3` | Level of the signal the position came from (or `lv`). |
| `enter` | `2026-02-10` | Entry date. |
| `enter_price` | `230.50` | Entry price. |
| `tag` | `TP` | `TP` (take profit, sell all), `TP 1` / `TP 2` (two-step take profit: half, then the rest), `STOP LOSS` or `TIME`. Rows with any other tag are skipped. |
| `date` | `2026-03-10` | Exit date. |
| `days_ago` | `1` | Trading days since the exit (not needed when `forming` is true). |
| `price` | `241.60` | Price at the exit. |
| `move` | `0.048` | `price / enter_price - 1`, as a **fraction**. |
| `forming` | `False` | `True` = the exit may fire at today's close. |

## Troubleshooting

- **"No scanner found"** on the Signals tab: set `MC_SCANNER_DIR` to the folder that holds your `scan.py` (or copy
  `example-scanner/scan.py` there) and open the app again.
- **"Python was not found"**: install Python 3, or set `MC_PYTHON` to its full path. On Windows, the Microsoft Store
  `python` shortcut does not count.
- **Google refuses the sign-in inside the app**: set a password on your TradingView account (Profile, then Password) and
  sign in with email instead.
- **A blank window or other oddities**: look in `logs/main.log` in the app's settings folder.

## Security notes

- **Renderer locked down.** The app page runs with `contextIsolation`, `sandbox` and no Node integration, under a strict
  Content-Security-Policy. It reaches the main process only through a small preload bridge (`window.mc`); every IPC call
  is accepted only from the app's own page, and every argument is validated in the main process.
- **Links** leave the app only as `http(s)` pages, opened in your default browser.
- **TradingView** loads the real tradingview.com in its own view and its own persistent session (separate from the app
  page). You sign in with your own TradingView account on TradingView's own pages; the app never sees your password. It
  only checks whether TradingView's session cookie exists, to show "TV signed in". The view may use the clipboard and
  fullscreen, nothing else (no camera, microphone, location or notifications). Sign-in pop-ups (TradingView, Google,
  Apple, Facebook, X) stay in the app so the session is shared; any other link opens in your browser.
- **Switching the chart**: when you click a row, the app runs a short script in the TradingView page that switches the
  symbol and interval through TradingView's page API when it is present; otherwise it loads the chart's address.
- **Packaged builds** turn on Electron fuses: the executable can't run as plain Node, ignores `NODE_OPTIONS` and
  `--inspect`, encrypts its cookies, and only loads its own integrity-checked `app.asar`.
- **One copy at a time** (single-instance lock), so two windows never fight over the session or the scan files.
- **Logs** stay on your computer. Each line is cleaned before it is written: long token-like strings become `[hidden]`
  and account-number-like strings keep only their last 4 characters.
- **Your scanner is your code.** The app runs `scan.py` from the folder you choose with your own user's permissions. Only
  point `MC_SCANNER_DIR` at code you trust.

## Disclaimer

This software is for information and education only. It is **not financial advice**, and nothing in it is a
recommendation to buy or sell any security or option. Options involve substantial risk and are not suitable for everyone;
you can lose more than you expect. The example scanner's data is fictional. Model numbers such as "chance of profit" are
estimates from a pricing model, not predictions. Check every price with your broker before you trade. You are solely
responsible for your trades.

Mission Control is an independent project. It is **not affiliated with, endorsed by or sponsored by TradingView or
Yahoo**. Market data comes from Yahoo through the unofficial [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2)
library: it is delayed (about 15 minutes for options), may be incomplete or wrong, and may stop working if Yahoo changes
its service. Use of TradingView and Yahoo is subject to their own terms.

## License

[MIT](LICENSE)
