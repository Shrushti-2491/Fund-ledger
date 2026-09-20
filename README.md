# Fund Ledger

A simple, free, mobile-friendly web app for tracking mutual fund investments —
built to replace manual spreadsheet upkeep. Log every SIP instalment or
redemption, and it automatically works out your units, current value, gain,
and **CAGR (XIRR)** — both per fund and across your whole portfolio.

No account, no sign-up, no server. Everything runs entirely in your browser.

## What it does

- **Ledger tab** — log transactions: date, fund name, Buy/Sell, amount, NAV.
  Units are calculated for you.
- **Holdings tab** — one row per fund. Type in the fund's latest NAV whenever
  you check it, and units held, amount invested, current value, gain, and
  CAGR (XIRR) all update automatically. A Portfolio Total row blends
  everything into one number.
- **Backup** — since your data lives only in this browser (see below), an
  Export/Import button lets you save and restore a `.json` backup file.

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
   Drag in all four files from this folder — `index.html`, `style.css`,
   `app.js`, and this `README.md` — then click "Commit changes".

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

## A note on NAV

This app doesn't fetch NAV automatically — you type it into the Holdings tab
whenever you check it. Auto-fetching from AMFI's daily NAV file needs either
a backend server or Excel-specific tools (like Power Query), neither of
which fit a plain, free, static GitHub Pages site. If you'd like, this can
be added later as a small serverless function — just ask.
