import express from "express";
const app = express();
const PORT = 5001
app.get("/" , (req,res)=>res.send("Server Running Successfully"));
app.listen(PORT , ()=>console.log(`Server listening on PORT:${PORT}`)
)