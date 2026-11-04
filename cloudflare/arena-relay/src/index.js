// 等待模式的轉發站：一個房間代碼＝一個 Durable Object。
// 主畫面（host）跑遊戲模擬；手機（pad）只送輸入。這裡不跑任何遊戲邏輯，
// 只負責：替每支手機配一個 id、把手機訊息加上 id 轉給 host、把 host 的狀態廣播回手機。
// ponytail: 不做持久化與重連補帳，房間只活在直播那一兩個小時。

const ROOM_RE = /^[A-Z0-9]{3,12}$/;
const MAX_PADS = 200;
const PAD_MSG_PER_SEC = 40; // 搖桿 20Hz + 施法，超過的直接丟掉

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([^/]+)\/(host|pad)$/);
    if (!m) return new Response('ai-chant-magic arena relay', { status: url.pathname === '/' ? 200 : 404 });
    const code = m[1].toUpperCase();
    if (!ROOM_RE.test(code)) return new Response('bad room', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(req);
  },
};

export class ArenaRoom {
  constructor(state) {
    this.state = state;
    this.host = null;
    this.pads = new Map(); // id -> { ws, n, windowStart }
    this.seq = 0;
  }

  async fetch(req) {
    const role = new URL(req.url).pathname.endsWith('/host') ? 'host' : 'pad';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    if (role === 'host') this.attachHost(server);
    else if (this.pads.size >= MAX_PADS) { server.close(1013, 'room full'); return new Response(null, { status: 101, webSocket: client }); }
    else this.attachPad(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  attachHost(ws) {
    // 新的主畫面取代舊的（例如重新整理）。手機不用重連，只要重新報到。
    if (this.host) try { this.host.close(1000, 'replaced'); } catch {}
    this.host = ws;
    for (const id of this.pads.keys()) this.send(ws, { t: 'hello', id });
    this.broadcast({ t: 'host', up: true });
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'st') this.broadcast(msg);            // 全體狀態，手機自己挑自己那筆
      else if (msg.t === 'kick' && this.pads.has(msg.id)) this.pads.get(msg.id).ws.close(1000, 'kicked');
    });
    const gone = () => { if (this.host === ws) { this.host = null; this.broadcast({ t: 'host', up: false }); } };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  attachPad(ws) {
    const id = 'p' + (++this.seq).toString(36) + Math.random().toString(36).slice(2, 6);
    const pad = { ws, n: 0, windowStart: Date.now() };
    this.pads.set(id, pad);
    this.send(ws, { t: 'you', id, host: !!this.host });
    ws.addEventListener('message', (ev) => {
      const now = Date.now();
      if (now - pad.windowStart >= 1000) { pad.windowStart = now; pad.n = 0; }
      if (++pad.n > PAD_MSG_PER_SEC) return;
      if (typeof ev.data !== 'string' || ev.data.length > 512) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      msg.id = id; // 身分由這裡蓋上，手機自己填的不算
      if (this.host) this.send(this.host, msg);
    });
    const gone = () => {
      if (!this.pads.has(id)) return;
      this.pads.delete(id);
      if (this.host) this.send(this.host, { t: 'leave', id });
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  broadcast(obj) { const s = JSON.stringify(obj); for (const p of this.pads.values()) try { p.ws.send(s); } catch {} }
}
