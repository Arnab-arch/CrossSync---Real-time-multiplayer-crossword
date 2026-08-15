import { useEffect, useRef, useState } from "react";
import { Connection } from "./connection";
import { CursorInterpolator } from "./interpolation";
import { renderCursor, removeCursor, colorForClient } from "./render";
import { puzzle } from "./puzzle";
import type { ServerMessages } from "./protocol";
import "./App.css";

const CLIENT_ID = crypto.randomUUID();
const ROOM_NO = "Room 1"; // static for now — single room per assignment scope

interface ActivityEntry {
    id: string;
    text: string;
    kind: "join" | "leave";
}

export default function App() {
    const containerRef = useRef<HTMLDivElement>(null);
    const connRef = useRef<Connection | null>(null);
    const interpolatorsRef = useRef<Map<string, CursorInterpolator>>(new Map());

    const [joined, setJoined] = useState(false);
    const [nameInput, setNameInput] = useState("");
    const [name, setName] = useState("");

    const [cells, setCells] = useState<Record<string, string>>({});
    // FIX/NEW: track WHO typed into each cell, so we know which color to glow
    const [cellOwners, setCellOwners] = useState<Record<string, string>>({});
    const [users, setUsers] = useState<Record<string, { name: string }>>({});
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);

    function logActivity(text: string, kind: "join" | "leave") {
        setActivity((prev) => [{ id: crypto.randomUUID(), text, kind }, ...prev].slice(0, 8));
    }

    function showToast(text: string) {
        const id = crypto.randomUUID();
        setToasts((prev) => [...prev, { id, text }]);
        // auto-dismiss after 3s — this is the "not compulsory" popup, just a passive notice
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3000);
    }

    // connection only opens once the user actually submits their name
    function handleJoin() {
        const trimmed = nameInput.trim();
        if (!trimmed) return;
        setName(trimmed);
        setJoined(true);
    }

    useEffect(() => {
        if (!joined) return; // don't connect until the landing form is submitted

        const conn = new Connection(import.meta.env.ITE_WS_URL, CLIENT_ID, name);
        connRef.current = conn;

        conn.onMessage((msg: ServerMessages) => {
            switch (msg.type) {
                case "messagesnap": {
                    const values: Record<string, string> = {};
                    const owners: Record<string, string> = {};
                    Object.entries(msg.cells).forEach(([id, c]) => {
                        values[id] = c.value;
                        owners[id] = c.userId;
                    });
                    setCells(values);
                    setCellOwners(owners);
                    setUsers(msg.users);
                    break;
                }
                case "user_joined":
                    setUsers((prev) => ({ ...prev, [msg.clientId]: { name: msg.name } }));
                    logActivity(`${msg.name} joined`, "join");
                    showToast(`${msg.name} joined the room`);
                    break;
                case "user_left": {
                    setUsers((prev) => {
                        const leftName = prev[msg.clientId]?.name ?? "Someone";
                        logActivity(`${leftName} left`, "leave");
                        const next = { ...prev };
                        delete next[msg.clientId];
                        return next;
                    });
                    interpolatorsRef.current.delete(msg.clientId);
                    removeCursor(msg.clientId);
                    break;
                }
                case "Cursor": {
                    let interp = interpolatorsRef.current.get(msg.clientId);
                    if (!interp) {
                        interp = new CursorInterpolator();
                        interpolatorsRef.current.set(msg.clientId, interp);
                    }
                    interp.addSample(msg.x, msg.y, msg.ts);
                    break;
                }
                case "reaction":
                    setCells((prev) => ({ ...prev, [msg.cellId]: msg.value }));
                    // NEW: remember who typed this, so we know which color to glow it
                    setCellOwners((prev) => ({ ...prev, [msg.cellId]: msg.clientId }));
                    break;
            }
        });

        return () => {
            conn.close();
            connRef.current = null;
        };
    }, [joined, name]);

    useEffect(() => {
        if (!joined) return;
        let raf: number;
        const loop = () => {
            const now = Date.now();
            interpolatorsRef.current.forEach((interp, clientId) => {
                const pos = interp.getInterpolatedPosition(now);
                if (pos && containerRef.current) {
                    const cursorName = users[clientId]?.name ?? "?";
                    renderCursor(containerRef.current, clientId, pos.x, pos.y, cursorName);
                }
            });
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [users, joined]);

    function handleMouseMove(e: React.MouseEvent) {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        connRef.current?.sendCursor(e.clientX - rect.left, e.clientY - rect.top);
    }

    function handleCellChange(cellId: string, value: string) {
        setCells((prev) => ({ ...prev, [cellId]: value }));
        setCellOwners((prev) => ({ ...prev, [cellId]: CLIENT_ID })); // optimistic local glow
        connRef.current?.sendReaction(cellId, value);
    }

    // ── Landing screen ──────────────────────────────────
    if (!joined) {
        return (
            <div className="landing">
                <div className="landing-card">
                    <h1>CrossSync</h1>
                    <p className="subtitle">Real-time multiplayer crossword</p>

                    <div className="landing-meta">
                        <div>
                            <b>{ROOM_NO}</b>
                            Room
                        </div>
                        <div>
                            <b>Pets 5x5</b>
                            Puzzle
                        </div>
                    </div>

                    <input
                        placeholder="Enter your name"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                        autoFocus
                    />
                    <button onClick={handleJoin} disabled={!nameInput.trim()}>
                        Enter Room
                    </button>
                </div>
            </div>
        );
    }

    // ── Main room ────────────────────────────────────────
    return (
        <div className="app">
            <div className="toast-stack">
                {toasts.map((t) => (
                    <div key={t.id} className="toast">{t.text}</div>
                ))}
            </div>

            <h1>CrossSync</h1>
            <p className="subtitle">{ROOM_NO} — Real-time multiplayer crossword</p>

            <div className="online-bar">
                <span className="online-dot" />
                {Object.keys(users).length + 1} online
                {Object.values(users).length > 0 &&
                    ` · ${Object.values(users).map((u) => u.name).join(", ")}`}
            </div>

            <div className="main-layout">
                <div className="grid-wrap">
                    <div
                        ref={containerRef}
                        className="grid"
                        onMouseMove={handleMouseMove}
                        style={{ gridTemplateColumns: `repeat(${puzzle.cols}, 44px)` }}
                    >
                        {puzzle.layout.map((row, r) =>
                            row.map((val, c) => {
                                const cellId = `${r}-${c}`;
                                const number = puzzle.numbers?.[cellId];
                                if (val === "#") {
                                    return <div key={cellId} className="cell cell-blocked" />;
                                }

                                const ownerId = cellOwners[cellId];
                                const glowColor = ownerId ? colorForClient(ownerId) : undefined;

                                return (
                                    <div key={cellId} className="cell">
                                        {number && <span className="cell-number">{number}</span>}
                                        <input
                                            maxLength={1}
                                            value={cells[cellId] || ""}
                                            onChange={(e) => handleCellChange(cellId, e.target.value.toUpperCase())}
                                            className={glowColor ? "cell-glow" : ""}
                                            style={glowColor ? ({ "--glow-color": glowColor } as React.CSSProperties) : undefined}
                                        />
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="clues-panel">
                    <h3>Across</h3>
                    {puzzle.clues.across.map((clue) => (
                        <div className="clue-item" key={clue.number}>
                            <b>{clue.number}.</b> {clue.text}
                        </div>
                    ))}
                </div>
            </div>

            <div className="activity-log">
                <h3>Activity</h3>
                {activity.length === 0 && <div className="activity-item">No activity yet</div>}
                {activity.map((entry) => (
                    <div key={entry.id} className={`activity-item ${entry.kind}`}>
                        {entry.text}
                    </div>
                ))}
            </div>
        </div>
    );
}