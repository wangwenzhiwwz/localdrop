"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Peer = { id: string; name: string; platform: string };
type QueueFile = { file: File; progress: number; status: "ready" | "sending" | "done" };
type Incoming = { from: string; fromName: string; transferId: string; files: { name: string; size: number; type: string }[] };

const formatSize = (bytes: number) => bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const deviceName = () => {
  if (typeof window === "undefined") return "此设备";
  const saved = localStorage.getItem("localdrop-name");
  if (saved) return saved;
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android 设备" : /Mac/.test(ua) ? "Mac" : "Windows 电脑";
};
const platformName = () => typeof navigator === "undefined" ? "浏览器" : (/Android/.test(navigator.userAgent) ? "Android" : /iPhone|iPad/.test(navigator.userAgent) ? "iOS" : /Mac/.test(navigator.userAgent) ? "macOS" : "Windows");

export default function Home() {
  const picker = useRef<HTMLInputElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const queueRef = useRef<QueueFile[]>([]);
  const receiveBuffers = useRef<Record<string, Record<number, string[]>>>({});
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selected, setSelected] = useState("");
  const [queue, setQueue] = useState<QueueFile[]>([]);
  const [connected, setConnected] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [toast, setToast] = useState("");
  const [me, setMe] = useState("此设备");

  useEffect(() => { queueRef.current = queue; }, [queue]);

  function flash(message: string) { setToast(message); setTimeout(() => setToast(""), 3500); }

  useEffect(() => {
    const name = deviceName(); setMe(name);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/localdrop-ws`);
    socket.current = ws;
    ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({ type: "register", name, platform: platformName() })); };
    ws.onclose = () => { setConnected(false); setPeers([]); };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "peers") { setPeers(msg.peers); setSelected((current) => msg.peers.some((p: Peer) => p.id === current) ? current : (msg.peers[0]?.id || "")); }
      if (msg.type === "offer") setIncoming(msg);
      if (msg.type === "accepted") { flash(`${msg.fromName} 已接受，开始发送`); void transmitFiles(msg.from, msg.transferId); }
      if (msg.type === "rejected") { setQueue((q) => q.map((x) => ({ ...x, status: "ready", progress: 0 }))); flash("对方拒绝了文件"); }
      if (msg.type === "chunk") { receiveBuffers.current[msg.transferId] ??= {}; receiveBuffers.current[msg.transferId][msg.fileIndex] ??= []; receiveBuffers.current[msg.transferId][msg.fileIndex].push(msg.data); }
      if (msg.type === "file-complete") finishReceivedFile(msg);
      if (msg.type === "transfer-complete") flash("文件接收完成");
    };
    return () => ws.close();
  }, []);

  function send(message: object) { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message)); }
  function addFiles(files: FileList | File[]) { setQueue((q) => [...q, ...Array.from(files).map((file) => ({ file, progress: 0, status: "ready" as const }))]); }
  function inputChanged(e: ChangeEvent<HTMLInputElement>) { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }
  function drop(e: DragEvent) { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }

  function requestSend() {
    if (!selected) return flash("请先选择一台附近设备");
    if (!queue.length) return picker.current?.click();
    const transferId = crypto.randomUUID();
    setQueue((q) => q.map((x) => ({ ...x, status: "sending", progress: 0 })));
    send({ type: "offer", target: selected, transferId, files: queue.map(({ file }) => ({ name: file.name, size: file.size, type: file.type })) });
    flash("已发送请求，等待对方确认…");
  }

  async function transmitFiles(target: string, transferId: string) {
    const chunkSize = 48 * 1024;
    const filesToSend = queueRef.current;
    for (let fileIndex = 0; fileIndex < filesToSend.length; fileIndex++) {
      const file = filesToSend[fileIndex].file;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
        let binary = ""; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        send({ type: "chunk", target, transferId, fileIndex, data: btoa(binary) });
        const progress = Math.min(100, Math.round((offset + bytes.length) / file.size * 100));
        setQueue((q) => q.map((x, i) => i === fileIndex ? { ...x, progress, status: progress === 100 ? "done" : "sending" } : x));
        await new Promise((r) => setTimeout(r, 4));
      }
      send({ type: "file-complete", target, transferId, fileIndex, name: file.name, mime: file.type });
    }
    send({ type: "transfer-complete", target, transferId }); flash("传输完成");
  }

  function finishReceivedFile(msg: { transferId: string; fileIndex: number; name: string; mime: string }) {
    const chunks = receiveBuffers.current[msg.transferId]?.[msg.fileIndex] || [];
    const arrays = chunks.map((value) => { const raw = atob(value); const data = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i); return data; });
    const url = URL.createObjectURL(new Blob(arrays, { type: msg.mime || "application/octet-stream" }));
    const a = document.createElement("a"); a.href = url; a.download = msg.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    delete receiveBuffers.current[msg.transferId][msg.fileIndex];
  }

  function acceptIncoming() { if (!incoming) return; receiveBuffers.current[incoming.transferId] = {}; send({ type: "accept", target: incoming.from, transferId: incoming.transferId }); setIncoming(null); flash("已接受，文件传输中…"); }
  function rejectIncoming() { if (!incoming) return; send({ type: "reject", target: incoming.from, transferId: incoming.transferId }); setIncoming(null); }

  const target = peers.find((p) => p.id === selected);
  const total = useMemo(() => queue.reduce((s, x) => s + x.file.size, 0), [queue]);

  return <main>
    <header className="topbar"><a className="brand" href="#"><span className="brandMark"><i/><i/><i/></span><span>LocalDrop</span></a><div className={`statusPill ${connected ? "" : "offline"}`}><span className="pulse"/> {connected ? `局域网已连接 · ${me}` : "未连接本地服务"}</div><div className="headerActions"><button className="avatar">{me.slice(0, 2).toUpperCase()}</button></div></header>
    <section className="workspace">
      <aside className="sidebar"><div className="sectionTitle"><div><span>附近设备</span><small>{peers.length} 台在线</small></div><button className="refresh" onClick={() => location.reload()}>↻</button></div>
        <div className="deviceList">{peers.length ? peers.map((p, i) => <button key={p.id} className={`device ${selected === p.id ? "active" : ""}`} onClick={() => setSelected(p.id)}><span className={`deviceIcon ${i % 2 ? "blue" : "mint"}`}>{p.platform === "Android" || p.platform === "iOS" ? "▯" : "⌘"}</span><span className="deviceText"><b>{p.name}</b><small>{p.platform} · LocalDrop</small></span><span className="onlineDot"/></button>) : <div className="emptyDevices"><b>正在寻找设备…</b><span>让其他设备打开当前局域网地址</span></div>}</div>
        <div className="privacy"><span>♢</span><div><b>仅限当前局域网</b><small>文件不会上传到云端</small></div></div>
      </aside>
      <section className="content"><div className="heroCopy"><p className="eyebrow">{target ? <>发送到 <span>●</span> {target.name}</> : "等待附近设备加入"}</p><h1>把文件放下，<br/>直接送到身边。</h1><p>设备通过当前局域网发现，文件由本机服务实时传输。</p></div>
        <div className={`dropzone ${dragging ? "dragging" : ""}`} onDragEnter={(e)=>{e.preventDefault();setDragging(true)}} onDragOver={(e)=>e.preventDefault()} onDragLeave={()=>setDragging(false)} onDrop={drop} onClick={()=>picker.current?.click()} role="button" tabIndex={0}><input ref={picker} type="file" multiple hidden onChange={inputChanged}/><div className="uploadIcon"><span>↑</span></div><h2>拖放文件到这里</h2><p>或 <u>浏览本机文件</u></p><small>支持任意格式 · 文件仅在局域网传输</small></div>
        {queue.length > 0 && <div className="queue"><div className="queueHead"><div><b>待发送</b><span>{queue.length} 个文件 · {formatSize(total)}</span></div><button onClick={()=>setQueue([])}>清空</button></div>{queue.map((x,i)=><div className="fileRow" key={`${x.file.name}-${i}`}><span className="fileType">{x.file.name.split(".").pop()?.slice(0,3).toUpperCase()}</span><div className="fileInfo"><b>{x.file.name}</b><small>{formatSize(x.file.size)} · {x.status === "ready" ? "等待发送" : x.status === "done" ? "已完成" : `发送中 ${x.progress}%`}</small>{x.status !== "ready" && <span className="progress"><i style={{width:`${x.progress}%`}}/></span>}</div>{x.status === "ready" && <button className="remove" onClick={()=>setQueue(q=>q.filter((_,n)=>n!==i))}>×</button>}</div>)}<button className="sendButton" onClick={requestSend}>{target ? `发送给 ${target.name}` : "选择接收设备"} <span>→</span></button></div>}
        <div className="tip"><span>↗</span><p><b>小提示</b>接收设备需要保持页面打开。</p></div>
      </section>
    </section>
    {incoming && <div className="modalBackdrop"><div className="modal"><span className="modalIcon">↓</span><h2>{incoming.fromName} 想发送文件</h2><p>{incoming.files.map(f=>f.name).join("、")}<br/>{formatSize(incoming.files.reduce((s,f)=>s+f.size,0))}</p><div className="receiveActions"><button onClick={rejectIncoming}>拒绝</button><button className="modalPrimary" onClick={acceptIncoming}>接受并下载</button></div></div></div>}
    {toast && <div className="toast">{toast}</div>}
  </main>;
}
