import type { clientMessage , ServerMessages } from "./protocol";

type listener = (msg:ServerMessages)=>void ;     // just listen to the server message and return nothing 


// just a class that handles the individual connection if a websocket and im using private here because 
// i want the code in this class to be able to access this file not outside react components so if 
// the connection type changes in future i can just hcnage the connection listener intead of th ewhole UI 

export class Connection{
    private ws:WebSocket ;
    private clientId :string ;
    private seq =0 ;
    private listeners:listener[]=[];
    private lastCursorSentAt = 0 ;
    private readonly CURSOR_THROTTLE = 40 ; 

    constructor(url:string , clientId :string , name :string){
        this.clientId = clientId ;
        console.log("connected to:" ,url);
        
        this.ws = new WebSocket(url) ;

        this.ws.onopen = ()=>{
            console.log("websocket connected");
            
            this.send({type:"join" , clientId , name})
        };
        this.ws.onmessage=(event)=>{
            const msg = JSON.parse(event.data) as ServerMessages ;
            console.log("server to client:",msg);
            

            // heartbeat im handling internally logically no need for the UI to know 
            if (msg.type ==="ping"){
                console.log("Ping received");
                this.send({type:"pong" , clientId:this.clientId})
                return;
            }
            this.listeners.forEach((fn)=>fn(msg));
        };
        this.ws.onclose =()=>{
            console.log("websocket disconnected");
            
        };
        this.ws.onerror = (error) => {
            console.error(
                "WebSocket error:",
                error
            );
        };
    }
    // erery message passed through the array if all listeners
    onMessage(fn:listener){
        this.listeners.push(fn);
    }
    private send(msg:clientMessage){
        if (this.ws.readyState === WebSocket.OPEN){
            console.log("client to server:",msg);
            
            this.ws.send(JSON.stringify(msg))
        }else{
             console.warn(
                "WebSocket not open. Message not sent:",
                msg
            );
        }
    }

    sendCursor(x:number ,y:number){
        const now = Date.now();
        // basically the throttle allowed will not allow continous action to websocket which is not good 
        if (now -this.lastCursorSentAt < this.CURSOR_THROTTLE) return ;
        this.lastCursorSentAt = now ;
        this.seq+=1 ;
        this.send({type:"cursor" , clientId:this.clientId ,x,y , seq:this.seq ,ts:now});


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
    this.ws.close();
  }

}