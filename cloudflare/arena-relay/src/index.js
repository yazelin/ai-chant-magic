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
    const q = new URL(req.url).searchParams;
    if (role === 'host') this.attachHost(server, q.get('hk'), q.get('takeover') === '1');
    else if (this.pads.size >= MAX_PADS) { server.close(1013, 'room full'); return new Response(null, { status: 101, webSocket: client }); }
    else this.attachPad(server, new URL(req.url).searchParams.get('k'));
    return new Response(null, { status: 101, webSocket: client });
  }

  attachHost(ws, hk, takeover) {
    // 一個房間只能有一個主畫面在跑模擬。同一個分頁重新整理（hk 相同）或明確接手才取代；
    // 別的分頁再開同一個房間，回 busy 並關掉，避免兩個主畫面互踢、各跑各的。
    if (this.host && this.hostKey !== hk && !takeover) {
      this.send(ws, { t: 'busy' });
      try { ws.close(4001, 'host busy'); } catch {}
      return;
    }
    if (this.host) { this.send(this.host, { t: 'taken' }); try { this.host.close(4002, 'replaced'); } catch {} }
    this.host = ws;
    this.hostKey = hk;
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

  attachPad(ws, key) {
    // 手機帶著自己記住的 k 重連時沿用同一個 id，大螢幕就接回原本的角色。
    // 同一個 k 又連進來（例如切回 App），舊的那條直接關掉，不送 leave。
    const id = /^[a-z0-9]{8,32}$/.test(key ?? '') ? 'k' + key : 'p' + (++this.seq).toString(36) + Math.random().toString(36).slice(2, 6);
    const old = this.pads.get(id);
    const pad = { ws, n: 0, windowStart: Date.now() };
    this.pads.set(id, pad);
    if (old) try { old.ws.close(1000, 'replaced'); } catch {}
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
      if (this.pads.get(id) !== pad) return; // 已被同一支手機的新連線取代
      this.pads.delete(id);
      if (this.host) this.send(this.host, { t: 'leave', id });
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  broadcast(obj) { const s = JSON.stringify(obj); for (const p of this.pads.values()) try { p.ws.send(s); } catch {} }
}
