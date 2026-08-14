import type { WebSocket } from "ws";  // i just need the type of connection to be websockket not the actual connection 


export interface ConnectedCLient{
    ws:WebSocket ;
    clientId:string ;
    name:string;
    isAlive:boolean ;
    
}
export interface CellState{
    value:string;
    userId:string;
}
// basically my server memory for this project , also can use redis but due to 
// time contraint sticking wiht this 
export const room = {
    cells:{} as Record<string , CellState> ,  // key should be string and value cellstate 
    clients: new Map<string , ConnectedCLient>(),     // map because i can get , delete , check all the clients easily 
    lastSeq : new Map <string , number>(),    
}
export function addclient(clientId:string , name:string , ws:WebSocket){
    room.clients.set(clientId , {ws , clientId ,name ,isAlive:true});  // thats why i used map its easy to set new clients

}

export function removeClient(clientId :string){
    room.clients.delete(clientId);
    room.lastSeq.delete(clientId);
}

export function updatecell(cellId:string , value:string , userId:string){
    room.cells[cellId] = {value , userId}
}

// to accept the latest message and remove duplicates and stale values we want he newer value to be inserted 

export function isStale(clientId:string , seq:number) : boolean{
    const last = room.lastSeq.get(clientId) ?? -1 ;   // for the user that have not sent anything yet the last value would be 0 
    if (seq <= last) return true ;   // we have to drop it 
    room.lastSeq.set(clientId ,seq) ;  // settiing the latest value
    return false ;

} 
// any new user joined can see from the exact spot the application is running 
// (current snaphot of the room)
export function CurrentSnapshot(){
    const users : Record<string , {name:string}>={};
    room.clients.forEach((e) => {
        users[e.clientId]= {name:e.name};
        
    });
    return {cells : room.cells ,users}
}
// all user gets update when new user joins 
export function broadcast(message : object , excludedClientId ?:string){
    const data = JSON.stringify(message);
    room.clients.forEach((c)=>{
        if (c.clientId === excludedClientId) return ;  // basically when a user 
        // joins others should get the join message but the user dont have to .for user that we dont have to send the update to optional parameter i used here
        if (c.ws.readyState === c.ws.OPEN){   // only send the data if the conenction is open 
            c.ws.send(data); 
        }
    });
}