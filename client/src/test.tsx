import { useEffect, useRef, useState } from "react";

export default function TestSocket() {
    const socketRef = useRef<WebSocket | null>(null);

    const [name, setName] = useState<string>("");
    const [connected, setConnected] = useState<boolean>(false);
    const [cellValue, setCellValue] = useState<string>("");
    const [users, setUsers] = useState<
        { clientId: string; name: string }[]
    >([]);

    // Generate the client ID once when the component initializes.
    const [clientId] = useState<string>(
        () => Math.random().toString(36).substring(2, 10)
    );

    // Sequence number for outgoing messages.
    const seqRef = useRef<number>(0);

    function connect(): void {
        // Connect to CrossSync WebSocket server on PORT 5001
        const ws = new WebSocket("ws://localhost:5001");

        socketRef.current = ws;

        ws.onopen = () => {
            console.log("Connected to server");

            setConnected(true);

            // Send join message
            ws.send(
                JSON.stringify({
                    type: "join",
                    clientId: clientId,
                    name: name,
                })
            );
        };

        ws.onmessage = (event: MessageEvent) => {
            const message = JSON.parse(event.data);

            console.log("Received:", message);

            switch (message.type) {
                // Server sends the current room state
                case "snapshot": {
                    console.log("Initial room state:", message);

                    setUsers(
                        Object.entries(message.users).map(
                            ([clientId, user]) => ({
                                clientId,
                                name: (user as { name: string }).name,
                            })
                        )
                    );

                    break;
                }

                // Another user joined
                case "user:joined": {
                    console.log(`${message.name} joined`);

                    setUsers((previousUsers) => [
                        ...previousUsers,
                        {
                            clientId: message.clientId,
                            name: message.name,
                        },
                    ]);

                    break;
                }

                // Another user left
                case "user:left": {
                    console.log(`${message.clientId} left`);

                    setUsers((previousUsers) =>
                        previousUsers.filter(
                            (user) =>
                                user.clientId !== message.clientId
                        )
                    );

                    break;
                }

                // Another user changed a cell
                case "reaction": {
                    console.log("Cell changed:", message);

                    setCellValue(message.value);

                    break;
                }

                // Cursor update
                case "cursor": {
                    console.log("Cursor update:", message);

                    break;
                }

                // Server heartbeat
                case "ping": {
                    console.log("Ping received from server");

                    // Respond to server heartbeat
                    ws.send(
                        JSON.stringify({
                            type: "pong",
                            clientId: clientId,
                        })
                    );

                    break;
                }

                default:
                    console.log("Unknown message:", message);
            }
        };

        ws.onclose = () => {
            console.log("Disconnected");

            setConnected(false);
        };

        ws.onerror = (error: Event) => {
            console.error("WebSocket error:", error);
        };
    }

    function updateCell(value: string): void {
        // Update our own UI immediately
        setCellValue(value);

        // Increase sequence number
        seqRef.current += 1;

        // Make sure WebSocket exists
        if (!socketRef.current) return;

        // Send reaction message to server
        socketRef.current.send(
            JSON.stringify({
                type: "reaction",
                clientId: clientId,
                cellId: "A1",
                value: value,
                seq: seqRef.current,
                ts: Date.now(),
            })
        );
    }

    // Close WebSocket when component is removed
    useEffect(() => {
        return () => {
            socketRef.current?.close();
        };
    }, []);

    return (
        <div
            style={{
                padding: "30px",
                fontFamily: "Arial",
            }}
        >
            <h1>CrossSync WebSocket Test</h1>

            <div>
                <input
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />

                <button
                    onClick={connect}
                    disabled={!name || connected}
                    style={{
                        marginLeft: "10px",
                    }}
                >
                    {connected ? "Connected" : "Join"}
                </button>
            </div>

            <p>
                Status:{" "}
                <strong>
                    {connected
                        ? "Connected 🟢"
                        : "Disconnected 🔴"}
                </strong>
            </p>

            <p>
                Your Client ID: <strong>{clientId}</strong>
            </p>

            <h3>Users</h3>

            {users.length === 0 ? (
                <p>No users connected.</p>
            ) : (
                users.map((user) => (
                    <div key={user.clientId}>
                        {user.name} ({user.clientId})
                    </div>
                ))
            )}

            <h3>Test Cell A1</h3>

            <input
                value={cellValue}
                onChange={(e) => updateCell(e.target.value)}
                disabled={!connected}
                placeholder="Type something..."
                style={{
                    width: "300px",
                    height: "50px",
                    fontSize: "20px",
                    padding: "10px",
                }}
            />
        </div>
    );
}