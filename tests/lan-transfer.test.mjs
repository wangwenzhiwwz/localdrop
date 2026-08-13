import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";

const endpoint = process.env.LOCALDROP_TEST_URL || "ws://127.0.0.1:4173/localdrop-ws";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function openDevice(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    ws.once("error", reject);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "register", name, platform: "Test" }));
      const ready = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type !== "peers") return;
        ws.off("message", ready);
        resolve(ws);
      };
      ws.on("message", ready);
    });
  });
}

function nextMessage(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`等待 ${type} 超时`)); }, timeout);
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      cleanup(); resolve(message);
    };
    const cleanup = () => { clearTimeout(timer); ws.off("message", handler); };
    ws.on("message", handler);
  });
}

function waitForPeer(ws, name, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`未发现设备 ${name}`)); }, timeout);
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      const peer = message.type === "peers" && message.peers.find((item) => item.name === name);
      if (!peer) return;
      cleanup(); resolve(peer);
    };
    const cleanup = () => { clearTimeout(timer); ws.off("message", handler); };
    ws.on("message", handler);
  });
}

test("devices discover, accept, transfer, and reconstruct an identical file", async () => {
  const senderName = `sender-${randomUUID().slice(0, 8)}`;
  const receiverName = `receiver-${randomUUID().slice(0, 8)}`;
  const sender = await openDevice(senderName);
  const peersPromise = waitForPeer(sender, receiverName);
  const receiver = await openDevice(receiverName);
  try {
    const peer = await peersPromise;
    const transferId = randomUUID();
    const original = randomBytes(768 * 1024 + 317);
    const received = [];

    const offerPromise = nextMessage(receiver, "offer");
    sender.send(JSON.stringify({ type: "offer", target: peer.id, transferId, files: [{ name: "random.bin", size: original.length, type: "application/octet-stream" }] }));
    const offer = await offerPromise;
    assert.equal(offer.files[0].size, original.length);

    const acceptedPromise = nextMessage(sender, "accepted");
    receiver.send(JSON.stringify({ type: "accept", target: offer.from, transferId }));
    const accepted = await acceptedPromise;

    receiver.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "chunk" && message.transferId === transferId) received.push(Buffer.from(message.data, "base64"));
    });
    for (let offset = 0; offset < original.length; offset += 48 * 1024) {
      sender.send(JSON.stringify({ type: "chunk", target: accepted.from, transferId, fileIndex: 0, data: original.subarray(offset, offset + 48 * 1024).toString("base64") }));
    }
    const completion = nextMessage(receiver, "file-complete");
    sender.send(JSON.stringify({ type: "file-complete", target: accepted.from, transferId, fileIndex: 0, name: "random.bin", mime: "application/octet-stream" }));
    await completion;
    assert.equal(Buffer.concat(received).length, original.length);
    assert.equal(digest(Buffer.concat(received)), digest(original));
  } finally { sender.close(); receiver.close(); }
});

test("receiver rejection is relayed to sender", async () => {
  const senderName = `reject-sender-${randomUUID().slice(0, 8)}`;
  const receiverName = `reject-receiver-${randomUUID().slice(0, 8)}`;
  const sender = await openDevice(senderName);
  const peersPromise = waitForPeer(sender, receiverName);
  const receiver = await openDevice(receiverName);
  try {
    const peer = await peersPromise;
    const offerPromise = nextMessage(receiver, "offer");
    sender.send(JSON.stringify({ type: "offer", target: peer.id, transferId: randomUUID(), files: [] }));
    const offer = await offerPromise;
    const rejectedPromise = nextMessage(sender, "rejected");
    receiver.send(JSON.stringify({ type: "reject", target: offer.from, transferId: offer.transferId }));
    await rejectedPromise;
  } finally { sender.close(); receiver.close(); }
});
