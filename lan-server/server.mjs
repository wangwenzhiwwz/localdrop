import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";

const port = Number(process.env.PORT || 4173);
const root = path.resolve("github-pages");
const clients = new Map();
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".woff2":"font/woff2", ".json":"application/json" };

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (pathname.startsWith("/localdrop/")) pathname = pathname.slice(10);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }); fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: "/localdrop-ws", maxPayload: 2 * 1024 * 1024 });
function broadcastPeers() { const all = [...clients.entries()].map(([id,c]) => ({ id, name:c.name, platform:c.platform })); for (const [id,c] of clients) c.ws.send(JSON.stringify({ type:"peers", peers:all.filter(p=>p.id!==id) })); }
wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  ws.on("message", (raw) => { try { const msg=JSON.parse(raw.toString()); if(msg.type==="register"){ clients.set(id,{ws,name:String(msg.name||"未知设备").slice(0,40),platform:String(msg.platform||"浏览器")}); broadcastPeers(); return; } const target=clients.get(msg.target); if(!target||target.ws.readyState!==WebSocket.OPEN)return; delete msg.target; if(msg.type==="accept")msg.type="accepted"; if(msg.type==="reject")msg.type="rejected"; target.ws.send(JSON.stringify({...msg,from:id,fromName:clients.get(id)?.name||"附近设备"})); } catch {} });
  ws.on("close",()=>{clients.delete(id);broadcastPeers()});
});
server.listen(port,"0.0.0.0",()=>{ const ips=[]; for(const list of Object.values(os.networkInterfaces())) for(const x of list||[]) if(x.family==="IPv4"&&!x.internal) ips.push(`http://${x.address}:${port}`); console.log("\nLocalDrop 已启动："); console.log(`本机：http://localhost:${port}`); ips.forEach(x=>console.log(`局域网：${x}`)); console.log("\n让其他设备打开上面的局域网地址。\n"); });
