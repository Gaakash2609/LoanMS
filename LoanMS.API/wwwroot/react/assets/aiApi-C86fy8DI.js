import{o as a}from"./index-DzejVWNY.js";const o={status:()=>a.get("/api/ai/status"),parse:(s,p,t)=>a.post("/api/ai/parse",{systemPrompt:s,userPrompt:p,maxTokens:t})};export{o as a};
