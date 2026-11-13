# Orbit plan agent: scenarios

Each scenario is a user case the build must support from start to finish. "Prototype" names the deep link that shows it
(`mockups/prototype/index.html?demo=<name>`). Numbers below come from the prototype's sample data.

## Finding ideas

**1. Morning look** (`setups`)
The trader opens Orbit. The market strip says *Market: selective. Leaders are fine, small caps are weak.* Ideas shows
today's setups grouped by the four playbooks that are on in a selective market. NVDA is *in the zone* for Leader
pullback, 1.1% above its 9-week EMA, and *+8 pts vs SMH over 3 months*. Breakout is off today, and its names are
tucked under *Show what's off today*.

**2. Is it diverging?** (`compare`, `lagging`)
From any name, the trader opens Compare. Orbit plots the stock against SPY, its sector ETF, and its peers from a common
start, plus the RS line against a chosen benchmark. It reads *Leading* or *Lagging* with the difference in points and a
flag such as *RS line at a new high before price: early strength*. MSFT reads *Lagging the market*, so it won't appear
in leader setups.

**3. Thesis from a screenshot** (`ideas`)
The trader types *IREN reported yesterday, up 15% premarket, risk $500* and drops a chart screenshot. Orbit checks the
screenshot is fresh against the live price, pulls context (quote, premarket range, typical move, loss budget), asks how
long to hold, and builds three plans.

**4. Chart work** (`chart`, `pullback`, `shorthist`)
On the chart the trader draws a level at the opening high, sets a price alert with the bell tool, zooms with the scroll
wheel, and resizes the chart. On daily bars the 8/9-week EMA band comes from real weekly closes. For a stock without
200 days of history, the chart says *SMA 200 needs 200 days of history* instead of drawing a misleading line.

## Planning and placing

**5. Size to the risk** (`plans`)
Three plans (Intraday, Swing, Options) each risk at most $500. Dragging the risk slider resizes all three. Intraday:
588 shares (sized at the $18.90 limit), buy when it trades $18.85, stop $18.05, sell half at $19.85 and the rest at $20.85, out by 3:55 PM. The intraday card shows
*Playbook: Opening high breakout*.

**6. Watch, don't trade yet** (`watching`)
The trader picks *Watch it*. The plan joins *Plans you're watching* with HOOD (Breakout and retest, 25¢ away) and NVDA
(Leader pullback). Orbit says when one gets close. Nothing is sent.

**7. Arm the breakout** (`console`, `armed`)
The trader holds the button (or Space) for 0.4 seconds. The bracket goes to IBKR as a buy stop-limit at $18.85, paying
no more than $18.90, with the stop and targets attached. When IREN trades $18.85, IBKR fills it with no delay from
Orbit or the connection. If a guardrail trips while it's armed, Orbit cancels it. If the gateway drops, the screen says
the order is still at IBKR and Orbit can't cancel it until it reconnects.

**8. Price ran away** (`chase`)
Price is 12¢ past the entry. Orbit won't chase: the button locks until price comes back under $18.90. Because the size
already assumes the $18.90 limit, a fill anywhere up to the limit still risks at most $500.

**9. Guardrails** (`daily`, `console` scenarios)
Daily loss limit reached, cooldown after a stop-out, three day trades used, spread too wide, gateway down: each locks
placing with a plain reason. Exits always work.

**10. The agent tries to trade** (`agent`)
The trader asks the agent to "just place it". The agent can't see or press the order controls. It shows the blocked
call and says only the trader can place.

## Managing the trade

**11. Target 1 hits** (`live`)
Half sells at $19.85. Three choices appear, one click each or keys 1–3: *Keep plan* (default after 45
seconds), *Lock in profit* (stop to entry), *Exit now*.

**12. One-click protection** (`live`, `keys`)
The trader tightens the stop with T, moves it to entry with L, exits with ⇧E, or flattens everything with ⇧F. Dragging
the stop up on the rail applies at once. Dragging it down opens the widen check.

**13. Widening needs a reason** (`widen`)
Widening is inline, needs a reason (one-tap chips or typed), must fit the per-trade limit, and takes a 0.4-second hold.

**14. Partial fill** (`partial`)
400 of 588 shares filled. The card shows the actual risk right now and offers *Cancel the rest* (one click) or *Keep
waiting until 11:00*.

**15. Back at the desk** (`away`)
A catch-up card (not a pop-up) lists what happened while the trader was away and what the plan did on its own. If a
position changed with no matching fill in Orbit's log (for example a stop filled while Orbit was closed), the card
says so.

**16. Everything else I hold** (`holdings`, `treemap`, `podium`)
Below the Orbit trade, every other position shows with its gain, today's move, *vs S&P over 3 months*, and its
protection. NVDA has no stop, so it's flagged *No stop* with *Protect it*. The PLTR call is tagged *Option*, expires in
8 days, and shows *At risk: $370*. Removing a protective stop takes a hold, because it adds risk; cancelling an entry
order is one click.

## Afterwards

**17. Review** (`review`)
Each trade is a story from Orbit's trade log. Results by playbook show win rate and average R per style. The memory
section shows exactly what the agent receives at Level 0 or Level 1.

**18. Tune a playbook** (`playbooks`)
The trader changes RS from 90 to 85 for Leader pullback, or turns Breakout on for selective markets. Orbit re-checks
today's setups. The agent can explain the rules but can't change them.

## Setup and failure

**19. Use my plan** (`settings`)
The agent starts on an API key. Once the sandbox test passes, the trader can pick *ChatGPT plan, through Codex* or
*Google AI Pro, through Antigravity CLI*. If the plan's limit runs
out, Orbit keeps working without the agent: every number, guardrail, and alert still comes from the engine.

**20. Gateway drops**
Live prices stop, placing locks, and a banner says Orbit is reconnecting. Stops and targets already at IBKR keep
working.
