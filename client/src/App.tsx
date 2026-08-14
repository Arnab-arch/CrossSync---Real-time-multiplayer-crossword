import { useEffect, useRef, useState } from "react";
import { Connection } from "./connection";
import { CursorInterpolator } from "./interpolation";
import { renderCursor, removeCursor } from "./render";
import { puzzle } from "./puzzle";
import type { ServerMessages } from "./protocol";
import "./App.css";

const CLIENT_ID = crypto.randomUUID();
const NAME = `User-${CLIENT_ID.slice(0, 4)}`;

interface ActivityEntry {
    id: string;
    text: string;
    kind: "join" | "leave";
}

export default function App() {
    const containerRef = useRef<HTMLDivElement>(null);
    const connRef = useRef<Connection | null>(null);
    const interpolatorsRef = useRef<Map<string, CursorInterpolator>>(new Map());

    const [cells, setCells] = useState<Record<string, string>>({});
    const [users, setUsers] = useState<Record<string, { name: string }>>({});
    const [activity, setActivity] = useState<ActivityEntry[]>([]);

    function logActivity(text: string, kind: "join" | "leave") {
        setActivity((prev) => [{ id: crypto.randomUUID(), text, kind }, ...prev].slice(0, 8));
    }

    useEffect(() => {
        // FIX: removed "if (connRef.current) return;" — under React StrictMode
        // this guard was silently blocking the SECOND real connection attempt
        // after the fake mount/unmount cycle, leaving no live connection at all.
        const conn = new Connection("ws://localhost:5001", CLIENT_ID, NAME);
        connRef.current = conn;

        conn.onMessage((msg: ServerMessages) => {
            switch (msg.type) {
                case "messagesnap": {
                    const values: Record<string, string> = {};
                    Object.entries(msg.cells).forEach(([id, c]) => (values[id] = c.value));
                    setCells(values);
                    setUsers(msg.users);
                    break;
                }
                case "user_joined":
                    setUsers((prev) => ({ ...prev, [msg.clientId]: { name: msg.name } }));
                    logActivity(`${msg.name} joined`, "join");
                    break;
                case "user_left": {
                    setUsers((prev) => {
                        const name = prev[msg.clientId]?.name ?? "Someone";
                        logActivity(`${name} left`, "leave");
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
                    break;
            }
        });

        // FIX: clear connRef on cleanup so a stale reference never lingers
        return () => {
            conn.close();
            connRef.current = null;
        };
    }, []);

    useEffect(() => {
        let raf: number;
        const loop = () => {
            const now = Date.now();
            interpolatorsRef.current.forEach((interp, clientId) => {
                const pos = interp.getInterpolatedPosition(now);
                if (pos && containerRef.current) {
                    const name = users[clientId]?.name ?? "?";
                    renderCursor(containerRef.current, clientId, pos.x, pos.y, name);
                }
            });
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [users]);

    function handleMouseMove(e: React.MouseEvent) {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        connRef.current?.sendCursor(e.clientX - rect.left, e.clientY - rect.top);
    }

    function handleCellChange(cellId: string, value: string) {
        setCells((prev) => ({ ...prev, [cellId]: value }));
        connRef.current?.sendReaction(cellId, value);
    }

    return (
        <div className="app">
            <h1>CrossSync</h1>
            <p className="subtitle">Real-time multiplayer crossword — sync engine demo</p>

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
                                // FIX: optional chaining so a missing entry never throws
                                const number = puzzle.numbers?.[cellId];
                                if (val === "#") {
                                    return <div key={cellId} className="cell cell-blocked" />;
                                }
                                return (
                                    <div key={cellId} className="cell">
                                        {number && <span className="cell-number">{number}</span>}
                                        <input
                                            maxLength={1}
                                            value={cells[cellId] || ""}
                                            onChange={(e) => handleCellChange(cellId, e.target.value.toUpperCase())}
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