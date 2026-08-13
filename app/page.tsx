"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type TransferFile = { id: string; name: string; size: number; progress: number; status: "ready" | "sending" | "done" };

const devices = [
  { id: "mac", name: "Lin 的 MacBook", detail: "macOS · Chrome", icon: "⌘", color: "mint" },
  { id: "phone", name: "Pixel 9", detail: "Android · LocalDrop", icon: "▯", color: "blue" },
  { id: "ipad", name: "客厅 iPad", detail: "iPadOS · Safari", icon: "⌁", color: "amber" },
];

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedDevice, setSelectedDevice] = useState("mac");
  const [files, setFiles] = useState<TransferFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);

  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  function addFiles(list: FileList | File[]) {
    const next = Array.from(list).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random()}`,
      name: file.name,
      size: file.size,
      progress: 0,
      status: "ready" as const,
    }));
    setFiles((current) => [...current, ...next]);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function sendFiles() {
    if (!files.length) return inputRef.current?.click();
    setFiles((current) => current.map((file) => ({ ...file, status: "sending", progress: 8 })));
    const timer = window.setInterval(() => {
      setFiles((current) => {
        const next = current.map((file) => {
          if (file.status !== "sending") return file;
          const progress = Math.min(100, file.progress + 9 + Math.floor(Math.random() * 15));
          return { ...file, progress, status: progress === 100 ? "done" as const : "sending" as const };
        });
        if (next.every((file) => file.status === "done")) {
          window.clearInterval(timer);
          setToast("传输完成 · 文件已安全送达");
          window.setTimeout(() => setToast(""), 3200);
        }
        return next;
      });
    }, 420);
  }

  const target = devices.find((device) => device.id === selectedDevice)!;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="LocalDrop 首页">
          <span className="brandMark"><i /><i /><i /></span>
          <span>LocalDrop</span>
        </a>
        <div className="statusPill"><span className="pulse" /> 局域网已连接 <b>·</b> 192.168.1.24</div>
        <div className="headerActions">
          <button className="iconButton" aria-label="切换显示模式">◐</button>
          <button className="avatar" aria-label="个人设置">ZH</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sectionTitle">
            <div><span>附近设备</span><small>{devices.length} 台在线</small></div>
            <button className="refresh" aria-label="刷新设备" onClick={() => { setOnline(false); setTimeout(() => setOnline(true), 650); }}>↻</button>
          </div>

          <div className={`deviceList ${online ? "" : "searching"}`}>
            {devices.map((device) => (
              <button key={device.id} className={`device ${selectedDevice === device.id ? "active" : ""}`} onClick={() => setSelectedDevice(device.id)}>
                <span className={`deviceIcon ${device.color}`}>{device.icon}</span>
                <span className="deviceText"><b>{device.name}</b><small>{device.detail}</small></span>
                <span className="onlineDot" />
              </button>
            ))}
          </div>

          <button className="codeButton" onClick={() => setCodeOpen(true)}><span>⌗</span> 使用配对码连接</button>
          <div className="privacy"><span>♢</span><div><b>端到端加密</b><small>文件仅在设备之间传输</small></div></div>
        </aside>

        <section className="content">
          <div className="heroCopy">
            <p className="eyebrow">发送到 <span>●</span> {target.name}</p>
            <h1>把文件放下，<br />剩下的交给我们。</h1>
            <p>无需上传云端。通过本地网络直接、安全地传输。</p>
          </div>

          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          >
            <input ref={inputRef} type="file" multiple onChange={handleInput} hidden />
            <div className="uploadIcon"><span>↑</span></div>
            <h2>拖放文件到这里</h2>
            <p>或 <u>浏览本机文件</u></p>
            <small>支持任意格式 · 单次最大 10 GB</small>
          </div>

          {files.length > 0 && (
            <div className="queue">
              <div className="queueHead"><div><b>待发送</b><span>{files.length} 个文件 · {formatSize(totalSize)}</span></div><button onClick={() => setFiles([])}>清空</button></div>
              {files.map((file) => (
                <div className="fileRow" key={file.id}>
                  <span className="fileType">{file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}</span>
                  <div className="fileInfo"><b>{file.name}</b><small>{formatSize(file.size)} · {file.status === "done" ? "已完成" : file.status === "sending" ? `发送中 ${file.progress}%` : "等待发送"}</small>{file.status !== "ready" && <span className="progress"><i style={{ width: `${file.progress}%` }} /></span>}</div>
                  {file.status === "ready" && <button className="remove" onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}>×</button>}
                  {file.status === "done" && <span className="check">✓</span>}
                </div>
              ))}
              <button className="sendButton" onClick={sendFiles}>发送给 {target.name} <span>→</span></button>
            </div>
          )}

          <div className="tip"><span>↗</span><p><b>小提示</b>保持此页面打开，传输速度会更快。</p><kbd>?</kbd></div>
        </section>
      </section>

      {codeOpen && <div className="modalBackdrop" onClick={() => setCodeOpen(false)}><div className="modal" onClick={(e) => e.stopPropagation()}><button className="modalClose" onClick={() => setCodeOpen(false)}>×</button><span className="modalIcon">⌗</span><h2>输入配对码</h2><p>在另一台设备上打开 LocalDrop，输入显示的 6 位数字。</p><div className="codeInput">· · · &nbsp; · · ·</div><button className="modalPrimary" onClick={() => { setCodeOpen(false); setToast("正在查找该设备…"); setTimeout(() => setToast(""), 2500); }}>连接设备</button></div></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
