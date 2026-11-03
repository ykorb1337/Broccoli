# Development

Broccoli is a native AppKit/WebKit desktop app with a Python local service, browser extensions, and local SQLite storage. Google Calendar is an optional, separate connection.

## Build and check

Requires macOS, Python 3.9+, Node.js and Apple Command Line Tools.

```sh
python3 -B -m unittest discover -s tests
python3 scripts/check_frontend.py
python3 scripts/build.py --qa --distribution
python3 tests/integration_uninstaller.py
```

The CI workflow lists the remaining isolated native and IPC checks. Tests use disposable data and processes. Never exercise physical sleep, lock, logout or shutdown as part of UI verification.

The default build includes a pinned, SHA-256-verified Python runtime and its notices. `--system-python` is for local development only. The app and installer use ad-hoc signatures; Developer ID signing and notarization are not configured.

## Interactive previews

```sh
python3 -B scripts/preview_today.py
```

Open `build/current-day-preview-url.txt`. This makes a fresh independent copy of the installed app’s current local day's real statistics. It copies no production rules, lock states, safety words or credentials and runs no enforcement or recording worker. Preview changes never write back. Automated unit tests may use deterministic fixtures.

`scripts/public_preview.py` is a separate publication-only tool: it retains real interval timings, replaces all activity text, omits images and credentials, and adds clearly fictional example rules and category annotations. Review every resulting screenshot before publishing; never capture personal calendars or the installed statistics for documentation.

## Packaging and compatibility

The main app is `build/Broccoli.app`; the DMG contains **Broccoli Installer**. **Broccoli Uninstaller** is a separate ZIP and is never embedded, downloaded, or linked in the app. Its removal backend is excluded from the main app. See [installation](INSTALLATION.md).

Keep the `local.hotturkey.desktop` bundle identity and IPC identifiers stable to preserve existing permissions and connections. New installations use `~/Library/Application Support/Broccoli`, the `broccoli` Python package and `broccoli.sqlite3`. Upgrades locate existing data in either application-support directory and retain compatibility with legacy databases. Explicit filename migrations checkpoint the database before renaming it; never rename an active SQLite WAL or SHM file independently.

The installer preserves databases, rules, budgets, recovery settings, browser permissions and Google credentials. Normal updates retain the lock gate. Uninstall is permitted during unrelated locks; an explicit uninstaller app rule or installer-blocking setting takes precedence. Uninstall retains local data and has reversible file staging.

Experimental protected-service work is not enabled by the normal installer. See [system service boundaries](SYSTEM-SERVICE.md), [validation](VALIDATION.md) and [security](../SECURITY.md).
