import type { clientMessage, ServerMessages } from "./protocol";

type listener = (msg: ServerMessages) => void;

const DEBUG = false;

export class Connection {
    private ws: WebSocket;
    private clientId: string;
    private name: string;
    private url: string;
    private seq = 0;
    private listeners: listener[] = [];
    private lastCursorSentAt = 0;
    private readonly CURSOR_THROTTLE = 30;

    // NEW: reconnect state
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_DELAY = 5000; // cap backoff at 5s
    private manuallyClosed = false; // so we don't reconnect after a deliberate close()

    constructor(url: string, clientId: string, name: string) {
        this.url = url;
        this.clientId = clientId;
        this.name = name;
        this.ws = this.connect();
    }

    private connect(): WebSocket {
        if (DEBUG) console.log("Connecting to:", this.url);

        const ws = new WebSocket(this.url);

        ws.onopen = () => {
            if (DEBUG) console.log("WebSocket connected");
            this.reconnectAttempts = 0; // reset backoff on a successful connect
            // using the SAME clientId on reconnect — this is what lets the
            // server recognize "same user coming back" instead of a duplicate
            this.sendRaw(ws, { type: "join", clientId: this.clientId, name: this.name });
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data) as ServerMessages;
            if (DEBUG) console.log("SERVER -> CLIENT:", msg);

            if (msg.type === "ping") {
                this.sendRaw(ws, { type: "pong", clientId: this.clientId });
                return;
            }
            this.listeners.forEach((fn) => fn(msg));
        };

        ws.onclose = () => {
            console.log("WebSocket disconnected");
            if (!this.manuallyClosed) {
                this.scheduleReconnect();
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            // onclose fires right after onerror for a failed connection,
            // so reconnect scheduling happens there, not duplicated here
        };

        return ws;
    }

    private scheduleReconnect() {
        // exponential backoff: 1s, 2s, 4s, capped at MAX_RECONNECT_DELAY
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.MAX_RECONNECT_DELAY);
        this.reconnectAttempts += 1;

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            if (!this.manuallyClosed) {
                this.ws = this.connect();
            }
        }, delay);
    }

    onMessage(fn: listener) {
        this.listeners.push(fn);
    }

    private sendRaw(ws: WebSocket, msg: clientMessage) {
        if (ws.readyState === WebSocket.OPEN) {
            if (DEBUG) console.log("CLIENT -> SERVER:", msg);
            ws.send(JSON.stringify(msg));
        } else {
            console.warn("WebSocket not open. Message not sent:", msg);
        }
    }

    private send(msg: clientMessage) {
        this.sendRaw(this.ws, msg);
    }

    sendCursor(x: number, y: number) {
        const now = Date.now();
        if (now - this.lastCursorSentAt < this.CURSOR_THROTTLE) return;
        this.lastCursorSentAt = now;
        this.seq += 1;
        this.send({ type: "cursor", clientId: this.clientId, x, y, seq: this.seq, ts: now });
    }

    sendReaction(cellId: string, value: string) {
        this.seq += 1;
        this.send({
            type: "reaction",
            clientId: this.clientId,
            cellId,
            value,
            seq: this.seq,
            ts: Date.now(),
        });
    }

    close() {
        this.manuallyClosed = true; // prevents scheduleReconnect from firing after a deliberate close
        this.ws.close();
    }
}