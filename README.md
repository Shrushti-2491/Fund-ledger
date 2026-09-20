# Fund Ledger

A simple, free, mobile-friendly web app for tracking mutual fund investments —
built to replace manual spreadsheet upkeep. Log every SIP instalment or
redemption, and it automatically works out your units, current value, gain,
and **CAGR (XIRR)** — both per fund and across your whole portfolio.

No account, no sign-up, no server. Everything runs entirely in your browser.

## What it does

- **Ledger tab** — log transactions: date, fund name, Buy/Sell, amount, NAV.
  Units are calculated for you.
- **Holdings tab** — one row per fund. Either add the fund's **AMFI Scheme
  Code** once and its NAV updates automatically every day, or just type the
  NAV in yourself whenever you check it — either way, units held, amount
  invested, current value, gain, and CAGR (XIRR) all update automatically.
  A Portfolio Total row blends everything into one number.
- **Backup** — since your data lives only in this browser (see below), an
  Export/Import button lets you save and restore a `.json` backup file.

## Automatic NAV updates (optional, one-time setup)

Every mutual fund's NAV is published once a day by AMFI in one shared file
covering every scheme in the country. A browser can't safely fetch that
file directly (a security rule called CORS blocks it), so this app uses a
small **GitHub Action** — a script that runs automatically on GitHub's own
servers once a day, downloads the file there instead of in your browser,
and saves a compact `nav.json` into your repo that the app reads instantly.
This is entirely free and needs no server of your own.

**To turn it on** (skip this if you're happy typing NAVs in by hand):

1. Once you've uploaded all the files (including the `scripts` and
   `.github` folders — GitHub's drag-and-drop upload preserves folder
   structure) and turned on GitHub Pages, go to your repository's
   **Settings → Actions → General**.
2. Scroll to "Workflow permissions" and select **"Read and write
   permissions"**, then Save. This lets the Action save the NAV file back
   into your repo.
3. Go to the **Actions** tab at the top of your repository. You should see
   a workflow called "Update mutual fund NAVs". Click it, then click **"Run
   workflow"** (top right) to fetch NAVs immediately instead of waiting for
   the daily schedule.
4. After it finishes (usually under a minute), check that a `nav.json`
   file with real data now exists in your repo.
5. On the **Holdings** tab of the app, find each fund's **Scheme Code** —
   search "`<fund name> scheme code AMFI`" online, or check a CAMS/KFintech
   statement — and type it into the Scheme Code box. Make sure you use the
   code for the correct Plan (Direct/Regular) and Option (Growth/IDCW) to
   match what you actually hold. The NAV fills in on its own within
   seconds.

From then on, the Action runs automatically on weekday evenings (Indian
time) and keeps `nav.json` current — you never need to trigger it manually
again. If you ever prefer a specific fund's NAV over the automatic one
(say AMFI briefly shows a stale figure), just type a number into that
fund's NAV box — a "Manual" tag appears with a **Use auto** link to switch
back whenever you like.

## ⚠️ Important: where your data lives

This app has no backend — no database, no login. Everything you type is
saved using your browser's `localStorage`, **on the one device and browser
you're using**. That means:

- It won't show up if you open the app on a different phone, computer, or
  even a different browser on the same device.
- Clearing your browser's site data/cache for this page will erase it.
- If you reinstall your phone's browser app or get a new phone, it's gone
  unless you've backed it up.

**Use the Export backup button regularly** (weekly is a good habit) and keep
the downloaded `.json` file somewhere safe (email it to yourself, save it to
Google Drive, etc.). If anything ever goes wrong, Import that file to get
everything back exactly as it was.

## How to put this on GitHub and host it for free

You don't need to know how to code for this part — just follow along.

1. **Create a GitHub account** at [github.com](https://github.com) if you
   don't have one already.

2. **Create a new repository**: click the `+` in the top-right corner →
   "New repository". Give it a name like `fund-ledger`. Keep it Public
   (required for the free hosting below). Click "Create repository".

3. **Upload the files**: on your new repository's page, click
   "uploading an existing file" (or the "Add file" → "Upload files" button).
   Drag in **everything** from the fund-ledger folder — `index.html`,
   `style.css`, `app.js`, `nav.json`, `README.md`, and the `scripts` and
   `.github` folders — then click "Commit changes". Dragging a folder in
   Chrome/Edge keeps its structure intact; if your browser flattens it
   instead, use "Add file" → "Create new file" and type the folder name as
   part of the file path (e.g. `scripts/fetch_nav.py`) to recreate it.

4. **Turn on GitHub Pages** (this is what makes it a live website):
   - Go to your repository's **Settings** tab.
   - In the left sidebar, click **Pages**.
   - Under "Build and deployment" → "Source", choose **Deploy from a
     branch**.
   - Under "Branch", choose **main** and folder **/(root)**, then **Save**.
   - Wait about a minute, then refresh the page — GitHub will show you a
     link like `https://yourusername.github.io/fund-ledger/`.

5. **Open that link on your phone** and add it to your home screen (in
   Chrome: menu → "Add to Home screen") so it opens like a regular app.

That's it — no build tools, no command line, nothing to install.

## Updating it later

If you ever want to tweak something (like the app's title), edit the file
directly on GitHub: open the file, click the pencil (✎) icon, make your
change, and commit it. GitHub Pages will redeploy automatically within a
minute or two.

## A note on Scheme Codes

Each fund has a different scheme code for every combination of Plan
(Direct/Regular) and Option (Growth/IDCW) — using the wrong one will pull
in the wrong NAV. If a fund's auto NAV looks off, double-check the code
against your account statement rather than guessing from a search result.
