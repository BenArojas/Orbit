# 8.1 — IBKR Connection Lifecycle — Manual Checklist

> Verify each flow. Mark ✅ / ❌ / ⚠️ in `docs/phase8-results.md` when done.

## Prereqs

- Backend running: `cd backend && uv run uvicorn main:app --port 8000`
- App running: `npm run tauri dev` (or built binary)
- IBKR Gateway provisioned

---

## A) Automated assertions

```
chmod +x scripts/phase8/check_8_1_ibkr_lifecycle.sh
./scripts/phase8/check_8_1_ibkr_lifecycle.sh
```

Expected: `All automated assertions passed.`

---

## B) Cold start → gateway spawns + auth prompt

1. Quit app fully. Stop the backend. Kill any `java`/gateway process.
2. Launch the app.
3. **Expect:**
   - Backend sidecar spawns (`/health` returns 200 within ~5s).
   - GatewaySetup view shows the provision/start flow (or skips straight to "Open IBKR Login" if already provisioned).
   - After clicking "Open IBKR Login" and signing in, status in the app turns green.

Pass criteria: status dot is green within 60s of launch.

---

## C) Gateway down at launch → banner + retry

1. Backend is up. Ensure gateway is **not** running (kill `java` / tray process).
2. Open the app (or reload the UI).
3. **Expect:**
   - UI shows "Start Gateway" / provisioning CTA (not the trading UI).
   - No crash, no blank screen.
4. Start the gateway, authenticate.
5. **Expect:** Status turns green; trading UI appears without a manual reload.

---

## D) Session expiry mid-run → `IBKRSessionExpiredError` → banner

1. App running, authenticated, dashboard visible.
2. In a second terminal:
   ```
   ./scripts/phase8/check_8_1_ibkr_lifecycle.sh poll
   ```
3. Kill the gateway (Activity Monitor → `java` with `ibgroup` in the command).
4. **Expect (within ~30s — `TICKLE_FAIL_THRESHOLD` × tickle interval):**
   - Poll output: `dropped=True`.
   - Amber banner appears in the app: *"IBKR session expired. Re-open the login page to reconnect."*
   - Banner has "Open IBKR Login" link + dismiss (✕).

---

## E) Re-auth banner CTA → reconnect success

1. With the banner visible (from step D), restart the gateway and authenticate in the browser.
2. **Expect:**
   - Within ~10s, banner disappears on its own (auto-dismiss on `authenticated: true`).
   - `./check_8_1_ibkr_lifecycle.sh poll` shows `dropped=False, auth=True`.
   - Live quotes resume in the dashboard.

---

## F) Network drop → clean `IBKRConnectionError`

1. App running, authenticated.
2. Block localhost:5001 temporarily:
   ```
   # macOS — requires sudo; using pfctl or just `sudo kill` the gateway
   sudo pfctl -t blocked -T add 127.0.0.1  # or just kill gateway
   ```
   Simpler: put machine in airplane mode, OR kill the gateway process.
3. Trigger a request: navigate to Analysis for any symbol.
4. **Expect:**
   - Toast: network / connection error (not a blank page, not a 500 JSON dump).
   - Backend log shows `IBKRConnectionError` raised, handled, logged once.
5. Re-enable network → gateway auto-recovers OR banner prompts reconnect.

---

## Backend unit coverage (already exists)

```
cd backend
uv run pytest tests/test_ibkr_disconnect.py tests/test_gateway.py -v
```

Expected: all green. (These cover the tickle-fail counter, broadcast-once semantics, and /gateway/status field presence.)

---

## Recording results

Fill `docs/phase8-results.md` → section 8.1 table. Only move on to 8.2 when all rows are ✅ or ⚠️ with notes.
