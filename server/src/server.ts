import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { ParseClientMsg, type ServerMessages } from "./protocol.js";
import {
    room,
    addclient,
    removeClient,
    updatecell,
    isStale,
    CurrentSnapshot,
    broadcast
} from "./room.js";

const PORT = process.env.PORT ? Number(process.env.PORT): 5001 ;

// normal http server created
const httpServer = createServer((req, res) => {
    res.writeHead(200);
    res.end("CrossSync Server running");
});

const wss = new WebSocketServer({ server: httpServer }); // upgrading the http connection to be websocket connection

const HEARTBEAT_INTERVAL = 15000; // server to check in with client in every 15s interval

wss.on("connection", (ws: WebSocket) => {
    let clientId: string | null = null;

    ws.on("message", (raw) => {
        const msg = ParseClientMsg(raw.toString());
        if (!msg) return;

        switch (msg.type) {

            // join case add client then taking the current state of the room and broadcasting 
            // to everyone except user that just joined 
            case "join": {
                clientId = msg.clientId;
                addclient(clientId, msg.name, ws);

                const snapshot = CurrentSnapshot(); // current snap of the room 
                ws.send(
                    JSON.stringify({ type: "messagesnap", ...snapshot })
                );

                broadcast(
                    { type: "user_joined", clientId, name: msg.name } satisfies ServerMessages,
                    clientId
                );

                break;
            }

            case "cursor": {
                if (isStale(msg.clientId, msg.seq)) return; // i want only the latest message

                broadcast(
                    {
                        type: "Cursor",
                        clientId: msg.clientId,
                        x: msg.x,
                        y: msg.y,
                        seq: msg.seq,
                        ts: msg.ts,
                    } satisfies ServerMessages,
                    msg.clientId
                );

                break;
            }

            case "reaction": {
                if (isStale(msg.clientId, msg.seq)) return;

                updatecell(msg.cellId, msg.value, msg.clientId);

                broadcast({
                    type: "reaction",
                    clientId: msg.clientId,
                    cellId: msg.cellId,
                    value: msg.value,
                    seq: msg.seq,
                    ts: msg.ts,
                } satisfies ServerMessages);

                break;
            }

            case "pong": {
                const client = room.clients.get(msg.clientId);

                if (client) client.isAlive = true;

                break;
            }
        }
    });
    ws.on("close" , ()=>{
        if (clientId){
            removeClient(clientId);
            broadcast({type:"user_left" , clientId} satisfies ServerMessages);
        }
    });
    ws.on("error",()=>{
        ws.close();
    });
});

// edge case if the client ping isnt alive i just remove the user 
setInterval(() => {
    room.clients.forEach((client)=>{
        if (!client.isAlive){
            client.ws.terminate();
            removeClient(client.clientId);
            broadcast({type:"user_left" , clientId:client.clientId}satisfies ServerMessages);
            return;
        }
        client.isAlive = false ;
        client.ws.send(JSON.stringify({type:"ping"} satisfies ServerMessages));
    });
    
}, HEARTBEAT_INTERVAL);

httpServer.listen(PORT , ()=>console.log(`server ruuning on ${PORT}`));
