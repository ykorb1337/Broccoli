# HotTurkey development

For interactive previews and update acceptance checks, use a fresh independent
copy of the installed application's **current local day's real statistics**:

```sh
python3 -B scripts/preview_today.py
```

Use `build/current-day-preview-url.txt` to open the authenticated local preview.
Create a fresh snapshot when starting the next test or preparing an update;
this is not a live connection to the installed database. Do not replace these
interactive previews with invented usage records. Deterministic automated
unit tests may continue to use isolated fixtures.

Keep previews isolated: no production rules, lock states, safety words or
credentials are copied; no enforcement or recording worker runs. Preview edits
must never write back to the installed application. Do not run physical sleep,
lock, logout or shutdown actions as part of UI verification.
