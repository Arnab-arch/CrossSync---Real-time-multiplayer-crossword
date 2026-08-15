rossSync — Architecture

1. System

flowchart LR
    A["Browser A<br/>React"] <-->|WebSocket| S["CrossSync Server<br/>Node.js + ws"]
    B["Browser B<br/>React"] <-->|WebSocket| S
    N["Browser N<br/>React"] <-->|WebSocket| S
    S --> P["Validate"]
    P --> R["Room State"]
    R --> BC["Broadcast"]
    BC --> A
    BC --> B
    BC --> N

2. Client

flowchart TD
    UI["App.tsx"] --> CON["Connection"]
    CON --> WS["WebSocket"]
    WS --> MSG["Server Message"]
    MSG --> UI
    UI --> CUR["Mouse Movement"]
    CUR --> TH["40ms Throttle"]
    TH --> CON
    MSG --> I["CursorInterpolator"]
    I --> RAF["requestAnimationFrame"]
    RAF --> REN["renderCursor"]

3. Server

flowchart TD
    HTTP["HTTP Server"] --> HEALTH["Health Check"]
    WSS["WebSocketServer"] --> RAW["Raw Message"]
    RAW --> V["ParseClientMsg()"]
    V -->|Invalid| DROP["Drop"]
    V -->|Valid| SW{"type"}
    SW --> J["join"]
    SW --> C["cursor"]
    SW --> R["reaction"]
    SW --> P["pong"]
    J --> ROOM["Room State"]
    C --> SEQ["isStale()"]
    R --> SEQ
    SEQ --> ROOM
    ROOM --> BC["broadcast()"]
    P --> ALIVE["isAlive = true"]

4. Protocol

flowchart LR
    J["join"] --> WS["WebSocket"]
    C["cursor"] --> WS
    R["reaction"] --> WS
    P["pong"] --> WS

    WS2["WebSocket"] --> SS["messagesnap"]
    WS2 --> UJ["user_joined"]
    WS2 --> UL["user_left"]
    WS2 --> CB["Cursor"]
    WS2 --> RB["reaction"]
    WS2 --> PG["ping"]

5. Join Flow

sequenceDiagram
    participant A as New User
    participant S as Server
    participant O as Other Users
    A->>S: join
    S->>S: validate
    S->>S: addclient
    S->>A: messagesnap
    S->>O: user_joined

6. Cell Sync

flowchart LR
    INPUT["User types"] --> LOCAL["Local UI"]
    LOCAL --> SEND["sendReaction"]
    SEND --> SERVER["Server"]
    SERVER --> V["Validate"]
    V --> SEQ["Sequence Check"]
    SEQ --> UPDATE["updatecell"]
    UPDATE --> BC["Broadcast"]
    BC --> OTHER["Other Clients"]

7. Sequence Protection

flowchart TD
    M["Incoming seq"] --> LAST["Get lastSeq"]
    LAST --> Q{"seq <= lastSeq?"}
    Q -->|Yes| D["Drop"]
    Q -->|No| A["Accept"]
    A --> SAVE["Save new seq"]
    SAVE --> PROCESS["Process"]

seq 1 → ACCEPT
seq 2 → ACCEPT
seq 3 → ACCEPT
seq 2 → DROP
seq 4 → ACCEPT

8. Cursor Sync

sequenceDiagram
    participant A as User A
    participant S as Server
    participant B as User B
    A->>A: Mouse move
    A->>A: 40ms throttle
    A->>S: cursor(x,y,seq,ts)
    S->>S: validate + isStale
    S->>B: cursor
    B->>B: interpolation sample
    B->>B: animation frame
    B->>B: render cursor

9. Cursor Interpolation

flowchart LR
    A["Sample A"] --> I["Interpolator"]
    B["Sample B"] --> I
    I --> D["100ms delay"]
    D --> T["Calculate t"]
    T --> CL["Clamp 0..1"]
    CL --> POS["Interpolated Position"]
    POS --> R["Render"]

Network:       ●────────●────────●
Direct:        ●        ●        ●
Interpolated:  ● · · · · ● · · · ●

10. Heartbeat

sequenceDiagram
    participant S as Server
    participant C as Client
    loop Every 15 seconds
        S->>S: isAlive = false
        S->>C: ping
        C->>S: pong
        S->>S: isAlive = true
    end
    Note over S,C: No pong → next sweep terminates client
    S->>C: terminate
    S->>S: removeClient
    S->>S: broadcast user_left

11. Disconnect

flowchart TD
    D{"Disconnect"}
    D -->|close event| R["removeClient"]
    D -->|heartbeat timeout| T["terminate"]
    T --> R
    R --> UL["user_left"]
    UL --> C["Other Clients"]
    C --> CLEAN["Remove user + cursor"]

12. Room State

flowchart TD
    ROOM["room"] --> USERS["clients<br/>Map"]
    ROOM --> CELLS["cells<br/>Record"]
    ROOM --> SEQS["lastSeq<br/>Map"]
    USERS --> U["ws + clientId + name + isAlive"]
    CELLS --> C["value + userId"]
    SEQS --> S["latest accepted seq"]

13. Complete Loop

flowchart LR
    ACTION["User Action"] --> CLIENT["React"]
    CLIENT --> CON["Connection"]
    CON --> WS["WebSocket"]
    WS --> SERVER["Server"]
    SERVER --> V["Validate"]
    V --> ORDER["Sequence Check"]
    ORDER --> STATE["Authoritative State"]
    STATE --> BC["Broadcast"]
    BC --> OTHER["Other Clients"]
    OTHER --> UPDATE["React / Interpolation"]
    UPDATE --> UI["Updated UI"]

14. Deployment

flowchart TD
    DEV["Developer"] --> GIT["GitHub"]
    GIT --> RENDER["Render"]
    RENDER --> INSTALL["npm install"]
    INSTALL --> BUILD["npm run build"]
    BUILD --> DIST["dist/server.js"]
    DIST --> START["npm start"]
    START --> LIVE["Live Node.js + ws"]
    LIVE --> HTTP["HTTPS"]
    LIVE --> WSS["WSS"]

Local:       ws://localhost:5001
Production:  wss://crosssync-real-time-multiplayer-crossword.onrender.com

15. Current vs Scaled

flowchart LR
    U["Clients"] --> S["One Node.js Server"]
    S --> M["In-memory Room"]

flowchart TD
    U["Clients"] --> LB["Load Balancer"]
    LB --> S1["WebSocket Server 1"]
    LB --> S2["WebSocket Server 2"]
    LB --> SN["WebSocket Server N"]
    S1 --> REDIS["Redis Pub/Sub"]
    S2 --> REDIS
    SN --> REDIS
    REDIS --> DB["PostgreSQL"]

16. Why Redis?

flowchart LR
    A["Client A"] --> S1["Server 1"]
    B["Client B"] --> S2["Server 2"]
    S1 --> R["Redis Pub/Sub"]
    R --> S2
    S1 -. "Without Redis" .-> X["Cannot broadcast<br/>to Server 2"]

17. Production Scale

flowchart TD
    USERS["Clients"] --> LB["Load Balancer"]
    LB --> S1["Node + ws #1"]
    LB --> S2["Node + ws #2"]
    LB --> SN["Node + ws #N"]
    S1 --> R["Redis"]
    S2 --> R
    SN --> R
    R --> PRES["Presence / Room Coordination"]
    S1 --> DB["PostgreSQL"]
    S2 --> DB
    SN --> DB

18. Scaling Path

flowchart LR
    A["1 Server"] --> B["Redis"]
    B --> C["Multiple WS Servers"]
    C --> D["Load Balancer"]
    D --> E["PostgreSQL + Monitoring"]

19. Design Principles

mindmap
  root((CrossSync))
    Server Authority
      Room State
      Sequence Ordering
    Separation
      UI
      Connection
      Protocol
      State
      Rendering
    Reliability
      Heartbeat
      Disconnect
    Performance
      Throttle
      Interpolation
    Validation
      Runtime Checks
      Stale Rejection
    Scalability
      Redis Pub/Sub
      Multiple Servers
      Load Balancer

20. One-Page Architecture

flowchart TB
    USERS["Users"] --> CLIENT["React Client"]
    CLIENT --> CON["Connection"]
    CON --> WS["WebSocket"]
    WS --> SERVER["Node.js + ws"]
    SERVER --> V["Validate"]
    V --> SEQ["Sequence Check"]
    SEQ --> ROOM["Authoritative Room"]
    ROOM --> BC["Broadcast"]
    BC --> OTHER["Other Clients"]
    OTHER --> I["Cursor Interpolation"]
    OTHER --> STATE["React State"]
    SERVER --> HB["Heartbeat"]
    HB --> PP["Ping / Pong"]
    HB --> LEFT["user_left"]
    SERVER -. Future .-> REDIS["Redis Pub/Sub"]
    REDIS -.-> SCALE["Multiple Servers"]

Final Flow

React Clients
      ↓
   WebSocket
      ↓
Node.js + ws
      ↓
Validate
      ↓
Sequence Check
      ↓
Authoritative Room State
      ↓
Broadcast
      ↓
Other Clients
      ↓
React State / Cursor Interpolation

Future Scale

Clients
   ↓
Load Balancer
   ↓
Multiple WebSocket Servers
   ↓
Redis Pub/Sub
   ↓
Shared Coordination
   ↓
PostgreSQL