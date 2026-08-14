// Protocol basically allows to give a know shape to the messages that travel over the websocket connection 
// it makes sure that client side and the server side both send messages that are desired 
// typescript helps us do that to give messsages a certain type field so we can narrow down which 
// shape we are dealing with 


// client side (messages type)
export interface JoinMessage {
    type:"join";
    clientId : string ;
    name : string ;
}

export interface CursorMessage{
    type:"cursor"
    clientId : string ;
    x:number;
    y:number;
    // sequential helps us know which is the latest message because in websocket the order of the 
    // messages can differ but i need the order so that the change required should be as per 
    // the last user change value so i know which update is newer
    seq:number;
    ts:number;
}
export interface ReactionMessage{
    type:"reaction";
    clientId : string ;
    cellId:string;
    value : string ;
    seq : number ;
    ts:number ;
}

export interface PongMessage{
    type:"pong";
    clientId:string ;
}

export type clientMessage = |JoinMessage | CursorMessage | ReactionMessage |PongMessage;



// Server Side (message type)

export interface snapshotMessage {
    type :"messagesnap";
    cells: Record<string , {value : string , userId :string}>;
    users: Record <string , {name :string}>
}

export interface UserJoinedMsg{
    type:"user_joined";
    clientId:string;
    name:string ;
}

export interface UserLeftMsg{
    type:"user_left" ;
    clientId :string ;
}

export interface CursorBrodcast {
    type:"Cursor";
    clientId:string ;
    x:number ;
    y:number;
    seq:number;
    ts:number ;     // timestamp for interpolation
}

export interface ReactionBroadcastMessage{
    type:"reaction";
    clientId:string ;
    cellId:string;
    value:string;
    seq:number;
    ts:number;
}

export interface PingMessage{
    type:"ping";
}

export type ServerMessages  = |snapshotMessage|UserJoinedMsg|UserLeftMsg|CursorBrodcast|ReactionBroadcastMessage|PingMessage;


// Runtime validation 
// Ts vanishes at runtime so I use JS to decide what to trust and what not to 


export function ParseClientMsg(raw: string): clientMessage | null {
    let data: unknown;


    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }


    if (
        typeof data !== "object" ||
        data === null ||
        !("type" in data)
    ) {
        return null;
    }


    const msg = data as Record<string, unknown>;


    // the fields required for that particular message.
    switch (msg.type) {

        case "join":
            if (
                typeof msg.clientId === "string" &&
                typeof msg.name === "string"
            ) {
                return msg as unknown as JoinMessage;
            }

            return null;


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


        case "reaction":
            if (
                typeof msg.clientId === "string" &&
                typeof msg.cellId === "string" &&
                typeof msg.value === "string" &&
                typeof msg.seq === "number" &&
                typeof msg.ts === "number"
            ) {
                return msg as unknown as ReactionMessage;
            }

            return null;


        case "pong":
            if (
                typeof msg.clientId === "string"
            ) {
                return msg as unknown as PongMessage;
            }

            return null;


        default:
          
            return null;
    }
}