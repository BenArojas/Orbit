# Gateway Lifecycle — How It Actually Works

A learning reference for the IBKR Gateway's process lifecycle in Parallax.
Read this when you want to understand *why* the code is the way it is, not
just what it does. Aimed at "I'm comfortable with Python and React but
process management is fuzzy."

> Last updated alongside `feat/gateway-lifecycle-ux` (2026-04-27).

---

## 1. The bug we're trying to prevent

You start the dev backend, log into IBKR, do work for a while, close the
terminal window, come back hours later — and the next launch fails with
"Port 5001 in use." Factory Reset is the only thing that clears it.

What actually happened:

- Closing a terminal sends `SIGHUP` to your shell.
- Uvicorn's worker process gets `SIGHUP` indirectly and dies *without*
  running our lifespan shutdown.
- The Java process running the Gateway was launched in a **separate POSIX
  session** (so we can group-kill it on shutdown), so it survives — it gets
  reparented to `launchd` (macOS) or `init` (Linux).
- That orphaned Java keeps holding port 5001 and your IBKR session.
- Next backend launch tries to spawn its own Java → port collision → error.

The fix has two layers: prevent the orphan when we can (best-effort signal
handling), and recover from it when we can't (pid-file based detection on
the next launch).

---

## 2. Process basics

### What is a process?

A running program with its own memory, file descriptors, and a unique
**PID** (process identifier — an integer). When a process spawns another,
the new one is a **child** with the spawner as its **parent**.

### Process tree, parent/child

Processes form a tree. PID 1 (`launchd` on macOS, `init` or `systemd` on
Linux) is the root. Everything else is descended from it.

```bash
# See every process related to "parallax" with its parent
ps -ef | grep -i parallax
# Show a tree
pstree -p $$            # bash on Linux
ps -axf                 # macOS approximation
```

### Process group (PGID) and session (SID)

Two grouping layers above individual processes:

- **Process group** — a set of related processes that can be signalled
  together. Identified by the PGID (which equals the PID of the group's
  leader). Use case: you press Ctrl+C in the shell and *all* foreground
  processes die, not just the one you can see.
- **Session** — a higher-level grouping containing one or more process
  groups, with one *controlling terminal*. When you close the terminal,
  `SIGHUP` is sent to the leader of the foreground group of that session.

`start_new_session=True` in `subprocess.Popen` puts the child in a brand
new session **detached from your terminal**. That's how we can prevent the
Java JVM from dying when *you* press Ctrl+C in the wrong terminal — but
it's also why a *clean* terminal close leaks Java if we don't intercept
the signal ourselves.

```bash
ps -o pid,pgid,sid,cmd <pid>     # see PGID and SID
kill -TERM -<pgid>               # negative arg = signal whole group
```

### Reparenting

If your parent process dies, the OS reparents you to PID 1. You're not
killed — you just have a new parent. **This is exactly how an orphan Java
ends up holding port 5001 even though your terminal is closed.**

### Useful commands

```bash
lsof -iTCP:5001 -sTCP:LISTEN     # who's holding port 5001?
ps -o pid,pgid,sid,cmd -p <pid>  # process metadata
kill -0 <pid>                    # "is this pid alive?" (no signal sent)
ps aux | grep ibgroup            # find any IBKR Gateway Java
```

---

## 3. Signal basics

A signal is a tiny message the OS delivers to a process. The process can
*handle* it (run a callback) or let the *default action* run (often:
terminate).

The signals that matter to us:

| Signal | Sent when… | Default action | Catchable? |
|--------|-----------|----------------|------------|
| `SIGINT` (2) | Ctrl+C in terminal | terminate | yes |
| `SIGTERM` (15) | `kill <pid>`, polite shutdown | terminate | yes |
| `SIGHUP` (1) | Terminal closed; controlling tty hung up | terminate | yes |
| `SIGQUIT` (3) | Ctrl+\\ | terminate + core dump | yes |
| `SIGKILL` (9) | `kill -9` — the nuclear option | terminate | **no** |
| `SIGSTOP` (19) | Pause a process | suspend | no |

**`SIGKILL` cannot be caught.** That's why pid-file recovery exists at all:
no signal handler in the world helps if the OS itself rips your process
out from under you.

By default uvicorn handles SIGINT and SIGTERM (graceful shutdown) but
ignores SIGHUP (Python default = terminate). That asymmetry is most of
this doc's reason for existing.

---

## 4. The Parallax process tree

Putting it all together — what's actually running while you develop:

```
launchd (PID 1)
  └─ Terminal.app
      ├─ zsh                                    [TERMINAL 1]
      │   └─ scripts/dev-backend.sh             ← bash wrapper
      │       └─ uv run uvicorn main:app …      ← uvicorn parent (--reload watcher)
      │           └─ uvicorn worker             ← the FastAPI server
      │               ├─ asyncio task: ScannerService loop
      │               ├─ httpx client → :5001
      │               └─ subprocess.Popen("/bin/sh run.sh root/conf.yaml")
      │                                          ↑ start_new_session=True
      │                                          ↑ — detaches into its own SID/PGID
      │                   └─ java -classpath … ibgroup.web.core … GatewayStart
      │                       └─ TLS listener on :5001
      │
      └─ zsh                                    [TERMINAL 2]
          └─ npm run tauri dev
              └─ vite dev server on :1420
              └─ Tauri webview window
                  ↑ talks to http://localhost:8000 (the Python sidecar)
                  ↑ talks to http://localhost:1420 (Vite for HTML/JS)
```

Two key observations:

1. The Gateway JVM is in a different session than the dev wrapper, on
   purpose. We can signal *it* via its PGID, but a SIGHUP to the wrapper's
   session doesn't reach Java.
2. Two terminals = two independent process trees. Killing one doesn't kill
   the other. Closing the JVM-owning terminal is what creates the orphan.

---

## 5. Three exit scenarios, traced end-to-end

### Scenario A — Ctrl+C (the clean path)

| Step | What happens |
|------|--------------|
| 1 | You press Ctrl+C |
| 2 | Kernel sends `SIGINT` to the foreground process group of the terminal |
| 3 | Both bash (the wrapper) and uvicorn receive it (same PGID) |
| 4 | Uvicorn handles `SIGINT` → starts graceful shutdown |
| 5 | Lifespan `__aexit__` runs → `await gateway.shutdown()` |
| 6 | `_kill_process_group()` sends `SIGTERM` to the JVM's PGID, then `SIGKILL` if needed |
| 7 | JVM exits, port 5001 freed |
| 8 | Pid file deleted by `_kill_process_group()` |
| 9 | Bash's `INT` trap also fires → calls `cleanup_gateway` (idempotent — pid file already gone, nothing to do) |
| 10 | Bash exits, terminal returns prompt |

Clean. No orphan.

### Scenario B — Close terminal window (your bug)

| Step | What happens |
|------|--------------|
| 1 | You click X / cmd-W |
| 2 | macOS sends `SIGHUP` to the shell's foreground process group |
| 3 | Both bash and uvicorn receive `SIGHUP` |
| 4 | Uvicorn does **not** handle `SIGHUP` → Python's default = die immediately |
| 5 | **Lifespan never runs.** JVM is left alive. |
| 6 | Bash's `HUP` trap fires → `cleanup_gateway` reads `~/.parallax/gateway/gateway.pid`, sends `SIGTERM` to the JVM's PGID, waits, escalates to `SIGKILL` if needed |
| 7 | Bash deletes the pid file and exits |
| 8 | Terminal disappears |

This is the part that wasn't working until the wrapper fix — see §7.

### Scenario C — `kill -9` or hard crash

| Step | What happens |
|------|--------------|
| 1 | Something sends `SIGKILL` (or the process page-faults, or the kernel panics) |
| 2 | Backend dies instantly — no signal handler runs |
| 3 | Bash trap doesn't run either if bash itself was killed |
| 4 | JVM is reparented to PID 1, still listening on :5001 |
| 5 | You launch the backend again later |
| 6 | `GatewayLifecycle.start()` → `_recover_existing_process()` reads the pid file, verifies the cmdline matches our gateway home, adopts the process |
| 7 | UI shows "running" + authenticated, no spawn |

The pid-file recovery is the **only** safety net for this scenario.

---

## 6. The cleanup chain in code

When everything works, this is the call chain that kills the JVM:

```
SIGINT/SIGTERM
   │
   ▼
uvicorn signal handler  (uvicorn/main.py — third-party)
   │
   ▼
asyncio loop stops accepting new requests
   │
   ▼
async with lifespan:  ←── backend/main.py
   yield                  (server runs here)
   ▼ (exit __aexit__)
await scanner.stop()
await ai.shutdown()
await ollama.shutdown()
await db.close()
await ibkr.shutdown()
await gateway.shutdown()  ←── backend/services/gateway.py
   │
   ▼
await self.stop()
   │
   ▼
self._kill_process_group()
   │
   ├─ POSIX:   os.killpg(pgid, SIGTERM)  →  os.killpg(pgid, SIGKILL)
   └─ Windows: subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)])
   │
   ▼
self._clear_pid_file()
```

Three things to know about this chain:

1. **The whole chain is async until `_kill_process_group`**, which is
   intentionally synchronous so callers can rely on the JVM being dead
   when it returns.
2. **`os.killpg(pgid, SIGTERM)` signals the entire group**, so the shell
   wrapper that ran `run.sh` and the Java JVM it spawned both die together.
   That's what `start_new_session=True` was setting up.
3. **The pid file is cleared at the end.** Next launch sees no pid file
   → no orphan to recover → fresh start. If this step is skipped (because
   we crashed before reaching it), the next launch's recovery handles it.

---

## 7. The pid-file safety net

Lives at `~/.parallax/gateway/gateway.pid`, written when we successfully
spawn the JVM:

```
pid=12345
pgid=12340
```

On every backend launch, `start()` does this in order:

1. **Already managing a process?** `self._process` (Popen) or
   `self._adopted_pid` set → no-op return.
2. **Anything responding on :5001?** If yes, try to adopt it via
   `_recover_existing_process()`. If we find the pid file and verify
   `psutil.Process(pid).cmdline()` contains our gateway home directory
   path, we mark the process as adopted (set `_adopted_pid` and
   `_process_pgid` so `stop()` can later signal it) and skip spawning.
3. **Stale pid file but nothing on the port?** Delete the file, proceed
   to spawn fresh.
4. **Spawn**: launch `run.sh root/conf.yaml`, capture pid + pgid, write
   the pid file.

The cmdline check is **defence in depth**: if a PID got recycled to an
unrelated process (your editor, a Slack helper, anything), we refuse to
adopt it — and crucially, refuse to ever signal it. The gateway home
path is the fingerprint because:

- During the brief shell phase, cmdline is `/bin/sh /Users/you/.parallax/gateway/bin/run.sh root/conf.yaml`.
- After `run.sh exec`s Java (no fork), cmdline becomes
  `java -classpath /Users/you/.parallax/gateway/dist/<jar> ibgroup.web.core … GatewayStart root/conf.yaml`.
- Either string contains `/Users/you/.parallax/gateway/` somewhere.

A Docker-hosted gateway has `/opt/clientportal.gw/dist/<jar>` in its
cmdline — never our home — so we won't try to manage it.

The fallback `process_iter` scan exists for the unhappy case where the
pid file got nuked but a JVM is still running. We walk every process on
the system once, find any with our home in cmdline, and adopt the first
match.

---

## 8. The `exec` gotcha in the dev wrapper

The first version of `scripts/dev-backend.sh` ended with:

```bash
trap on_signal INT TERM HUP
trap cleanup_gateway EXIT
exec uv run uvicorn main:app --reload --port 8000
```

`exec` replaces the bash process with `uv run uvicorn`. When bash is
replaced, **its signal handlers are gone too** — the new program (uvicorn)
inherits the file descriptors but not the trap dispositions. So the
traps were dead code: they'd only fire if a signal arrived between
installing the trap and the `exec` call (microseconds).

The fix: don't `exec`. Run uvicorn as a child process and let bash stay
alive to catch the signals uvicorn ignores:

```bash
trap on_signal INT TERM HUP
trap cleanup_gateway EXIT

uv run uvicorn main:app --reload --port 8000 &
UVICORN_PID=$!
wait "$UVICORN_PID"
```

Now:

- Bash and uvicorn are both in the foreground process group.
- Ctrl+C → both get `SIGINT`. Uvicorn cleans up via lifespan. Bash trap
  also runs `cleanup_gateway`, harmless because the pid file is already
  gone.
- Close terminal → both get `SIGHUP`. Uvicorn dies without cleanup. Bash
  trap **does** run `cleanup_gateway`, kills the JVM via the pgid in the
  pid file, writes nothing further. **No orphan.**
- `kill -9 <bash-pid>` → bash dies without trap → orphan → recovery on
  next launch.

The cost of this approach is that bash sticks around as an extra
process during the lifetime of the dev server. That's a single shell
process, ~2 MB. Worth it.

The Windows `.ps1` wrapper doesn't have this issue — PowerShell can't
`exec` like bash does, and `try/finally` plus `Console.CancelKeyPress`
together cover Ctrl+C and ordinary exits. Closing the PowerShell window
on Windows can still leak (Windows doesn't run `finally` on hard close)
— for that path we rely on the pid-file recovery.

---

## 9. Three-level recovery in the UI

The "Reset session" button used to mean "kill Java and respawn." That
was the only escalation we exposed, even when a much cheaper fix
(logout) would have worked. Now there are three explicit levels:

| Level | UI label | What it does | Time | When to reach for it |
|-------|----------|--------------|------|---------------------|
| R1 | Logout (sidebar) | `POST` IBKR `/v1/api/logout`, drop session, JVM stays | ~1 s | "Authenticating…" stuck; dispatcher loop after 2FA |
| R2 | Restart Gateway (sidebar) | `_kill_process_group` + respawn | ~10 s | Java itself wedged; logout didn't help |
| R3 | Factory Reset (Settings) | Restart + delete `root/logs`, `root/Jts`, `*.cookie`, `*.session` | ~10 s | Persisted IBKR session state is masking a clean start |

Always reach for the cheapest first. The on-disk binary install (JRE +
Gateway zip, ~100 MB) is **never** touched by any of these — there's a
separate `/gateway/reprovision` for re-downloading those if IBKR ships
an update.

---

## 10. Common debug recipes

### "Is anything holding the port?"

```bash
lsof -iTCP:5001 -sTCP:LISTEN
# Look at the COMMAND/PID columns
```

### "Is the orphan ours?"

```bash
PID=$(lsof -tiTCP:5001)
ps -o pid,command -p "$PID"
# Cmdline should contain ~/.parallax/gateway/
```

### "What's in the pid file right now?"

```bash
cat ~/.parallax/gateway/gateway.pid
ps -o pid,pgid,sid,command -p $(grep '^pid=' ~/.parallax/gateway/gateway.pid | cut -d= -f2)
```

### "Force kill any leftover gateway"

```bash
# Surgical — only kills processes whose cmdline mentions our home
pkill -f "$HOME/.parallax/gateway/"
rm -f ~/.parallax/gateway/gateway.pid
```

### "Watch the gateway's own log live"

```bash
tail -f ~/.parallax/gateway/gateway.log
```

### "Trace what signal a process got"

On macOS:

```bash
# In a second terminal, before sending the signal:
sudo dtruss -p <pid> 2>&1 | grep -i kill
```

On Linux:

```bash
strace -p <pid> -e signal
```

---

## 11. TL;DR cheat sheet

- A "process" is a running program with a PID. It can have child processes.
  Children of a dead parent get reparented to PID 1 — they survive.
- A "process group" (PGID) lets you signal a set of related processes
  together. The Gateway shell + Java share a PGID specifically so we can
  group-kill them in one call.
- Signals like `SIGINT`/`SIGTERM`/`SIGHUP` can be caught; `SIGKILL` and
  `SIGSTOP` cannot.
- Closing a terminal sends `SIGHUP`. Uvicorn doesn't catch it by default;
  our bash wrapper does and uses the pid file to clean up.
- A pid file at `~/.parallax/gateway/gateway.pid` lets the next launch
  recover from any case where graceful shutdown didn't run.
- `exec` in bash replaces the shell, killing all traps. Don't use it
  when you want signal handlers to survive.
- The cmdline check (`psutil.Process.cmdline()` contains our home path)
  is what protects us from accidentally killing unrelated processes.
- Three escalations: Logout → Restart Gateway → Factory Reset. Always
  reach for the cheapest one first.
