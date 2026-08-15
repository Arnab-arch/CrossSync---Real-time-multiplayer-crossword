# CrossSync — Real-Time Multiplayer Cursor/State Sync

A raw-WebSocket real-time sync engine — no Socket.IO, no Yjs, no
Liveblocks, no sync framework of any kind — demonstrated through a
collaborative crossword where multiple users share live cursor positions
and a discrete "reaction" action (typing a letter into a shared grid).

**Live demo:** https://cross-sync-real-time-multiplayer-cr.vercel.app
**Backend:** https://crosssync-real-time-multiplayer-crossword.onrender.com

> The backend runs on Render's free tier and may take 30–60s to wake up on
> the first request after a period of inactivity — open the link a minute
> before testing if it's been idle.

---

## Setup instructions

### Server
```bash
cd server
npm install
npm run dev
```
Runs on `http://localhost:5001`.

### Client
```bash
cd client
npm install
npm run dev
```
Runs on `http://localhost:5173`. Create `client/.env` (see
`client/.env.example`):
```
VITE_WS_URL=ws://localhost:5001
```

### Testing with multiple clients
Open `http://localhost:5173` in 3–5 browser tabs (or the deployed URL on
different devices). Each tab asks for a name before joining the shared
room — this satisfies the "3-5 tabs seeing each other's cursors" demo
requirement.

---

## Tech stack

- **Server:** Node.js, TypeScript, the `ws` package (a thin WebSocket
  transport library — not a sync framework; it gives raw connection
  primitives only, everything else — rooms, broadcast, presence,
  heartbeat — is hand-written)
- **Client:** React + TypeScript (Vite), native browser `WebSocket` API
  — no `socket.io-client` or equivalent
- **Deployment:** Render (backend, supports persistent WebSocket
  connections — required, since most static hosts including Vercel's
  serverless functions do not), Vercel (frontend static hosting)

---

## 1. Real-time sync engine

### Message protocol & type safety

Every message is a TypeScript discriminated union defined once in
`protocol.ts` (identical copy in `server/src/` and `client/src/`), with a
runtime validator that rejects anything malformed before the rest of the
app ever sees it — TypeScript types disappear at runtime, so this
function is the actual gatekeeper for what's trusted:

```typescript
export function ParseClientMsg(raw: string): clientMessage | null {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof data !== "object" || data === null || !("type" in data)) {
        return null;
    }
    const msg = data as Record<string, unknown>;
    switch (msg.type) {
        case "cursor":
            if (
                typeof msg.clientId === "string" &&
                typeof msg.x === "number" &&
                typeof msg.y === "number" &&
                typeof msg.seq === "number" &&
                typeof msg.ts === "number"
            ) {
                return msg as unknown as CursorMessage;
            }
            return null;
        // ...same pattern for join / reaction / pong
        default:
            return null; // unknown type — rejected, never guessed at
    }
}
```

**Full message list:**

| Direction | Type | Fields | Purpose |
|---|---|---|---|
| Client → Server | `join` | `clientId, name` | Join the room |
| Client → Server | `cursor` | `clientId, x, y, seq, ts` | Continuous position |
| Client → Server | `reaction` | `clientId, cellId, value, seq, ts` | Discrete action — typing a letter (this is our "tap to react at a point," where the point is a grid cell) |
| Client → Server | `pong` | `clientId` | Heartbeat response |
| Server → Client | `messagesnap` | `cells, users` | Full snapshot, sent once on join |
| Server → Client | `user_joined` / `user_left` | `clientId, name?` | Presence changes |
| Server → Client | `Cursor` | `clientId, x, y, seq, ts` | Relayed position |
| Server → Client | `reaction` | `clientId, cellId, value, seq, ts` | Relayed cell update |
| Server → Client | `ping` | — | Heartbeat request |

### New clients joining mid-session

Approach taken: **full state snapshot**, not replay. When a client sends
`join`, the server immediately sends back a `messagesnap` containing the
entire current `cells` object and `users` list, before anything else
happens:

```typescript
case "join": {
    clientId = msg.clientId;
    addclient(clientId, msg.name, ws);

    const snapshot = CurrentSnapshot();
    ws.send(JSON.stringify({ type: "messagesnap", ...snapshot } satisfies ServerMessages));

    broadcast({ type: "user_joined", clientId, name: msg.name } satisfies ServerMessages, clientId);
    break;
}
```
This was chosen over replaying the full action history because the
crossword's state is small and only the *current* value of each cell
matters — replaying every historical keystroke would be wasted work for
no visible benefit. Cursors aren't included in the snapshot at all (only
`cells` and `users`); a newly joined client simply waits for the next
`cursor` broadcast from each active user, which arrives within the normal
throttle window (~30ms), so the delay before seeing others' cursors is
negligible in practice.

### Throttling / bandwidth

Raw `mousemove` fires at 60–120Hz. Sending every event would be wasteful,
so outgoing cursor updates are capped client-side to once per 30ms
(~33/sec max) before they're even sent:

```typescript
sendCursor(x: number, y: number) {
    const now = Date.now();
    if (now - this.lastCursorSentAt < this.CURSOR_THROTTLE) return;
    this.lastCursorSentAt = now;
    this.seq += 1;
    this.send({ type: "cursor", clientId: this.clientId, x, y, seq: this.seq, ts: now });
}
```
That's a 2–4x reduction in traffic versus raw events, and combined with
client-side interpolation (next section), the reduced rate still renders
as smooth motion on receiving clients — the throttle trades a small,
imperceptible amount of positional resolution for meaningfully less
bandwidth.

`reaction` messages are not throttled — they're low-frequency by nature
(one per keystroke) and each one is meaningful state that must never be
silently dropped.

---

## 2. Interpolation & jitter handling

**Approach: buffered linear interpolation**, not extrapolation.

Each remote cursor keeps a rolling buffer of recent position samples
(capped at 20, so memory never grows unbounded across a long session).
Every animation frame, the renderer asks for a position at
`now - RENDER_DELAY_MS`, finds the two buffered samples that straddle
that target time, and linearly interpolates between them:

```typescript
getInterpolatedPosition(now: number): { x: number; y: number } | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1) return { x: this.samples[0].x, y: this.samples[0].y };

    const targetTime = now - this.RENDER_DELAY_MS;
    let prev = this.samples[0];
    let curr = this.samples[1];

    for (let i = 0; i < this.samples.length - 1; i++) {
        const a = this.samples[i];
        const b = this.samples[i + 1];
        if (a.ts <= targetTime && targetTime <= b.ts) {
            prev = a;
            curr = b;
            break;
        }
    }

    const span = curr.ts - prev.ts;
    if (span <= 0) return { x: curr.x, y: curr.y };
    const t = Math.max(0, Math.min(1, (targetTime - prev.ts) / span));
    return {
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
    };
}
```

**Why buffering instead of just the last two points:** an earlier version
of this only stored `prev`/`curr` (2 samples). With updates arriving every
~30–40ms and a 100ms render delay, `now - 100ms` regularly fell *before*
both stored samples — the interpolation factor `t` went negative, clamped
to 0, and the cursor visibly froze instead of moving. Keeping a small
buffer and searching it for the two samples that actually surround the
target time fixed this.

**Tradeoff:** `RENDER_DELAY_MS` is currently `70`. This is the dial
between latency and smoothness — a higher value guarantees smoother
motion (more buffer to work with) at the cost of the cursor visibly
lagging behind the sender's real position; a lower value feels more live
but risks running out of samples to interpolate between if the network
gets choppy. 70ms was chosen after testing 100ms felt slightly
unresponsive; under Chrome DevTools "Slow 3G" throttling, cursors still
move plausibly smoothly rather than snapping, at the cost of a bit more
visible lag relative to the sender.

---

## 3. Disconnect / reconnect handling

**Disconnect detection (server-side heartbeat):** every 15 seconds the
server pings all connected clients and flips their `isAlive` flag to
`false`; a `pong` response flips it back. Anyone still `false` on the
*next* sweep is terminated:

```typescript
setInterval(() => {
    room.clients.forEach((client) => {
        if (!client.isAlive) {
            client.ws.terminate();
            removeClient(client.clientId);
            broadcast({ type: "user_left", clientId: client.clientId } satisfies ServerMessages);
            return;
        }
        client.isAlive = false;
        client.ws.send(JSON.stringify({ type: "ping" } satisfies ServerMessages));
    });
}, HEARTBEAT_INTERVAL);
```
This bounds disconnect detection to roughly one heartbeat interval
(15–30s), using the raw `close`/`error`/ping-pong events directly rather
than any library's built-in reconnection logic.

**Client reconnect, without duplicating cursors or reloading:** the
client holds one stable `clientId` (generated once via
`crypto.randomUUID()` when the app loads) for the whole session. On an
unexpected `close`, it automatically reconnects with exponential backoff
(1s → 2s → 4s, capped at 5s) and rejoins using that *same* `clientId`:

```typescript
ws.onclose = () => {
    console.log("WebSocket disconnected");
    if (!this.manuallyClosed) this.scheduleReconnect();
};

private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.MAX_RECONNECT_DELAY);
    this.reconnectAttempts += 1;
    setTimeout(() => {
        if (!this.manuallyClosed) this.ws = this.connect();
    }, delay);
}
```
Because the identity is reused, the server sees this as the same user
resuming, not a new one joining — no duplicate cursor, no page reload
required. A `manuallyClosed` flag distinguishes a deliberate `close()`
call from an unexpected drop, so intentional disconnects don't trigger a
reconnect loop.

---

## 4. Conflict / ordering

Every `cursor` and `reaction` message carries a per-client sequence
number that increments on every send. The server tracks the last accepted
`seq` per client and drops anything at or below it:

```typescript
export function isStale(clientId: string, seq: number): boolean {
    const last = room.lastSeq.get(clientId) ?? -1;
    if (seq <= last) return true;
    room.lastSeq.set(clientId, seq);
    return false;
}
```
This handles real-world out-of-order delivery without requiring
synchronized clocks across machines — it only compares each client's own
sequence against its own last-seen value, so clock skew between different
users' devices never affects correctness.

---

## 5. Server design

**Room/presence management** lives entirely in `room.ts`, using a `Map`
(not a plain object) for O(1) add/remove/lookup and safe iteration.

**Broadcast fan-out** is a single loop, not nested — avoids the
O(n²) re-broadcast bug the assignment explicitly calls out:
```typescript
export function broadcast(message: object, excludedClientId?: string) {
    const data = JSON.stringify(message);
    room.clients.forEach((c) => {
        if (c.clientId === excludedClientId) return;
        if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    });
}
```
`excludedClientId` is optional — cursor broadcasts exclude the sender
(they already know their own position, no need to echo it back);
reaction broadcasts do *not* exclude the sender, so every client
(including the typer) updates its cell only in response to hearing the
message back from the server — this keeps state-update logic uniform
across all clients rather than having the sender update optimistically
through a different code path than everyone else.

---

## 6. Code architecture

Three separated layers:

- **Transport** — `connection.ts` (client), `server.ts` (server). Owns
  the raw WebSocket connection, reconnect/backoff, heartbeat response.
  Knows nothing about cursors or crossword logic specifically.
- **Protocol** — `protocol.ts` (shared, identical on both sides). Defines
  every message shape and validates incoming data.
- **Rendering** — `render.ts`, `interpolation.ts`. Pure,
  framework-agnostic logic for positioning/coloring cursors — no
  WebSocket code, no React, testable on their own.

`App.tsx` is the only file that wires all three together with actual UI.

**Extending to a new action type** — say, an emoji "reaction burst" —
would only touch `protocol.ts` (new message interface + union member) and
the two message-handling switch statements (`server.ts`, `App.tsx`).
`connection.ts` never changes, since it already generically forwards any
typed message to its registered listeners without knowing what's inside
them.

---

## How I'd expand this next



In words, the next things I'd build on top of this, roughly in priority
order:

1. **Horizontal scaling** — right now all room state lives in one
   process's memory (`room.ts`'s `Map`). Running multiple server
   instances behind a load balancer would break broadcasting immediately,
   since a client on instance A has no way to reach a client on instance
   B. The fix is a shared pub/sub layer (Redis is the standard choice) —
   every server instance publishes incoming messages to a shared channel
   instead of only broadcasting to its own local client list, and every
   instance subscribes to relay whatever comes through. Room membership
   would also need to move out of in-process memory into something all
   instances can read (Redis again, or a small database), so presence is
   consistent no matter which instance a given client is connected to.
2. **Multiple rooms** — the current build is intentionally a single
   shared room, since that's explicitly acceptable scope per the
   assignment FAQ. Expanding this is mostly mechanical: the server
   already models `room` as one object; turning that into a `Map<roomId,
   RoomState>` and adding a `roomId` field to every message would extend
   the existing broadcast/presence logic without needing a redesign.
3. **Adaptive throttling based on measured RTT** — currently the cursor
   throttle (30ms) is a fixed constant. A more advanced version would
   have the server track round-trip latency per client (timestamp a ping,
   measure the pong delay) and adjust how aggressively that specific
   client's updates get throttled or batched, so someone on a slow
   connection doesn't flood a queue that can't keep up.
4. **Basic conflict reconciliation for simultaneous cell edits** — right
   now, two people typing into the exact same cell at nearly the same
   time resolves via plain last-sequence-wins, which is honest but
   simple. A next step would be surfacing that visually (e.g. a brief
   flash showing "you were overwritten") rather than silently discarding
   the loser.
5. **Persisting room state** — currently everything resets on server
   restart. Even a lightweight persistence layer (SQLite, or periodic
   snapshotting to a file/small DB) would let the crossword survive a
   Render redeploy or free-tier spin-down without losing progress.

---

## Known limitations

- Single shared room (see expansion notes above)
- No persistence — state resets on server restart
- No authentication — names are self-reported, unverified
- No horizontal scaling implementation (written plan only, above)
- Render free-tier cold starts add latency on first connection after
  idling
- Reaction conflicts resolve via last-sequence-wins with no visible
  reconciliation UI

---

## AI tool disclosure

I used Claude (Anthropic) throughout this project, mainly to understand
concepts I hadn't implemented from scratch before — how WebSocket
heartbeat/ping-pong should be structured, why buffered interpolation
behaves differently from a naive two-point interpolation, how sequence
numbers solve out-of-order delivery, and how to reason about the
transport/protocol/rendering separation the assignment asks for. I wrote
the actual code myself and worked through the logic until I understood
why each piece behaves the way it does, not just that it works — I can
walk through the protocol, the interpolation math, the heartbeat/reconnect
flow, and the broadcast logic in detail if asked.

One piece I did have AI generate directly rather than write by hand: a
small `test.tsx` used to manually exercise the backend (sending test
`join`/`cursor`/`reaction` messages and logging responses) while I was
debugging the server in isolation, before the real client UI existed.
That file was a throwaway debugging tool, not part of the submitted
application logic.

---

## Time spent

Roughly 3 days, matching the assignment's suggested timeline: initial
scoping (including a pivot away from an early Socket.io-based prototype
once the actual raw-WebSocket requirement was clear), core engine
implementation (protocol, room state, server, client transport,
interpolation), the crossword demo UI, debugging (notably a React
StrictMode double-connection issue and the interpolation sample-buffer
bug described above), deployment to Render + Vercel, and this
documentation.