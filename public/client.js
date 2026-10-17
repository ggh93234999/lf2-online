(() => {
  'use strict';
  const PACK = '/packs/LF2_19/';
  const TEAM_COLORS = ['#ffffff', '#ff5a5a', '#5aa8ff', '#5ee07a', '#ffd84a'];
  const MAX_MEMBERS = 8;

  requirejs.config({
    baseUrl: '/engine/',
    paths: { mirror: '/mirror', soundpack: PACK + 'sound/soundpack' },
    config: { 'core/sprite-canvas': { baseUrl: PACK } },
  });

  const $ = s => document.querySelector(s);
  const canvas = $('#game');

  let ws = null, myId = null, lobby = null, catalog = null, inGame = false, ping = 0;
  let mirror = null, Mirror = null;
  const pending = []; // frames received before the renderer module loaded

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  requirejs(['mirror'], M => {
    Mirror = M;
    mirror = new Mirror(canvas);
    window.__mirror = mirror; // handy for debugging in the console
    for (const f of pending.splice(0)) mirror.apply(f.o, f.p);
  });

  // ------------------------------------------------------------------ sound
  const sound = { ctx: null, buf: null, map: null, on: store.get('lf2-sound') !== '0', loading: false };
  function initSound() {
    if (sound.ctx || sound.loading) return;
    sound.loading = true;
    try { sound.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    requirejs(['soundpack'], sp => {
      sound.map = sp.sound;
      fetch(PACK + 'sound/soundpack.mp3').then(r => r.arrayBuffer())
        .then(b => sound.ctx.decodeAudioData(b)).then(buf => { sound.buf = buf; })
        .catch(() => { /* no sound */ });
    });
  }
  function playSound(name) {
    if (!sound.on || !sound.buf || !sound.map || typeof name !== 'string') return;
    const id = name.includes('/') ? name.split('/')[1] : name;
    const seg = sound.map[id];
    if (!seg) return;
    const src = sound.ctx.createBufferSource();
    src.buffer = sound.buf;
    const g = sound.ctx.createGain();
    g.gain.value = 0.6;
    src.connect(g).connect(sound.ctx.destination);
    src.start(0, seg.start, seg.end - seg.start);
  }
  function updateSoundBtn() { $('#btnSound').textContent = sound.on ? '🔊' : '🔇'; }
  $('#btnSound').onclick = () => { sound.on = !sound.on; store.set('lf2-sound', sound.on ? '1' : '0'); updateSoundBtn(); initSound(); };
  updateSoundBtn();

  // ------------------------------------------------------------------ network
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function connect(onOpen) {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = onOpen;
    ws.onmessage = ev => onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      inGame = false; lobby = null; myId = null;
      showPanel('join');
      $('#joinErr').textContent = '和伺服器的連線中斷了，請重新進入';
    };
  }

  function applyFrame(m) {
    if (mirror) mirror.apply(m.o, m.p); else pending.push(m);
  }

  function onMessage(m) {
    switch (m.t) {
      case 'f':
        applyFrame(m);
        if (m.s) for (const s of m.s) playSound(s);
        break;
      case 'full':
        applyFrame(m);
        break;
      case 'welcome':
        myId = m.id;
        catalog = m.catalog;
        history.replaceState(null, '', `?room=${m.room}`);
        if (Mirror) Mirror.preload(catalog.characters.map(c => c.pic));
        break;
      case 'lobby':
        lobby = m;
        if (!inGame) { showPanel('room'); renderLobby(); }
        updateWhoami();
        break;
      case 'start':
        $('#goArrow').classList.add('hidden');
        if (mirror) mirror.reset();
        pending.length = 0;
        inGame = true;
        $('#summary').classList.add('hidden');
        showPanel(null);
        updateWhoami();
        break;
      case 'stop':
        inGame = false;
        $('#banner').classList.add('hidden');
        $('#goArrow').classList.add('hidden');
        $('#summary').classList.add('hidden');
        showPanel('room');
        renderLobby();
        break;
      case 'summary': showSummary(m); break;
      case 'banner': showBanner(m.text, m.ms || 2500); break;
      case 'go':
        $('#goArrow').classList.remove('hidden');
        clearTimeout(goTimer);
        goTimer = setTimeout(() => $('#goArrow').classList.add('hidden'), 3000);
        playSound('1/m_pass');
        break;
      case 'pong': ping = Math.round(performance.now() - m.ts); $('#pingText').textContent = `延遲 ${ping} ms`; break;
      case 'err':
        $('#joinErr').textContent = m.msg;
        $('#roomErr').textContent = m.msg;
        break;
    }
  }
  setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);

  let goTimer = 0, bannerTimer = 0;
  function showBanner(text, ms) {
    const b = $('#banner');
    b.textContent = text;
    b.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
  }

  // ------------------------------------------------------------------ input
  const KEYMAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyJ: 'att', KeyZ: 'att', KeyK: 'jump', KeyX: 'jump', KeyL: 'def', KeyC: 'def',
  };
  const down = new Set();
  const isHeld = k => [...down].some(c => KEYMAP[c] === k);
  addEventListener('keydown', e => {
    initSound();
    if (!inGame) return;
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (e.repeat || down.has(e.code)) return;
    const was = isHeld(k);
    down.add(e.code);
    if (!was) send({ t: 'k', k, d: 1 });
  });
  addEventListener('keyup', e => {
    if (!down.delete(e.code)) return;
    const k = KEYMAP[e.code];
    if (!isHeld(k)) send({ t: 'k', k, d: 0 });
  });
  addEventListener('blur', () => {
    const ks = new Set([...down].map(c => KEYMAP[c]));
    down.clear();
    for (const k of ks) send({ t: 'k', k, d: 0 });
  });

  // ------------------------------------------------------------------ lobby UI
  function showPanel(which) {
    $('#overlay').classList.toggle('hidden', which === null);
    $('#panel-join').classList.toggle('hidden', which !== 'join');
    $('#panel-room').classList.toggle('hidden', which !== 'room');
    $('#ingame-bar').classList.toggle('hidden', which !== null);
  }

  const charById = id => catalog.characters.find(c => c.id === id);
  const charPic = id => (id === -1 || !charById(id) ? null : PACK + charById(id).pic);

  function updateWhoami() {
    if (!lobby) return;
    const i = lobby.players.findIndex(p => p.id === myId);
    const me = lobby.players[i];
    if (!me || !catalog) { $('#whoami').textContent = '觀戰中'; return; }
    const c = me.char === -1 ? '隨機角色' : charById(me.char).name;
    $('#whoami').textContent = `你是 ${c}（第 ${i + 1} 格）`;
    $('#btnStop').classList.toggle('hidden', lobby.host !== myId);
  }

  function renderLobby() {
    if (!lobby || !catalog) return;
    const me = lobby.players.find(p => p.id === myId);
    const isHost = lobby.host === myId;
    $('#roomCode').textContent = lobby.room;
    $('#roomErr').textContent = '';

    const slots = $('#slots');
    slots.innerHTML = '';
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const p = lobby.players[i];
      const d = document.createElement('div');
      if (!p) { d.className = 'slot empty'; d.textContent = '空位'; slots.appendChild(d); continue; }
      d.className = 'slot' + (p.id === myId ? ' me' : '');
      const img = document.createElement('img');
      img.src = charPic(p.char) || PACK + 'UI/random.png';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.style.color = TEAM_COLORS[p.team];
      nm.textContent = (lobby.host === p.id ? '👑 ' : '') + p.name;
      const info = document.createElement('div');
      const cname = p.char === -1 ? '隨機' : charById(p.char).name;
      info.innerHTML = `<span class="tag">${cname}</span> <span class="tag">${p.team ? '第 ' + p.team + ' 隊' : '無隊伍'}</span>`;
      d.append(img, nm, info);
      if (p.bot && isHost) {
        const sc = document.createElement('select');
        sc.add(new Option('隨機', -1, false, p.char === -1));
        for (const c of catalog.characters) sc.add(new Option(c.name, c.id, false, c.id === p.char));
        sc.onchange = () => send({ t: 'pick', id: p.id, char: Number(sc.value) });
        const st = document.createElement('select');
        for (let t = 0; t <= 4; t++) st.add(new Option(t ? `第 ${t} 隊` : '無隊伍', t, false, t === p.team));
        st.onchange = () => send({ t: 'pick', id: p.id, team: Number(st.value) });
        const sa = document.createElement('select');
        for (const a of catalog.AI) sa.add(new Option('AI: ' + a.name, a.id, false, a.id === p.ai));
        sa.onchange = () => send({ t: 'pick', id: p.id, ai: Number(sa.value) });
        const rm = document.createElement('button');
        rm.textContent = '移除';
        rm.onclick = () => send({ t: 'kick', id: p.id });
        d.append(sc, st, sa, rm);
      }
      slots.appendChild(d);
    }

    const chars = $('#chars');
    chars.innerHTML = '';
    for (const c of [...catalog.characters, { id: -1, name: '隨機', pic: 'UI/random.png' }]) {
      const b = document.createElement('button');
      b.className = 'char' + (me && me.char === c.id ? ' sel' : '');
      const img = document.createElement('img');
      img.src = PACK + c.pic;
      const nm = document.createElement('b');
      nm.textContent = c.name;
      b.append(img, nm);
      b.onclick = () => send({ t: 'pick', char: c.id });
      chars.appendChild(b);
    }

    const teams = $('#teams');
    teams.innerHTML = '';
    for (let t = 0; t <= 4; t++) {
      const b = document.createElement('button');
      b.textContent = t ? `第 ${t} 隊` : '無';
      b.style.color = TEAM_COLORS[t];
      if (me && me.team === t) b.className = 'sel';
      b.onclick = () => send({ t: 'pick', team: t });
      teams.appendChild(b);
    }

    const stageMode = lobby.settings.mode === 'stage';
    for (const b of document.querySelectorAll('#modes button')) {
      b.classList.toggle('sel', b.dataset.mode === lobby.settings.mode);
      b.disabled = !isHost;
    }
    $('#vsOpts').classList.toggle('hidden', stageMode);
    $('#stageOpts').classList.toggle('hidden', !stageMode);
    $('#teams').previousElementSibling.classList.toggle('hidden', stageMode);
    $('#teams').classList.toggle('hidden', stageMode);
    const ss = $('#stageSelect');
    ss.innerHTML = '';
    for (const st of catalog.stages) ss.add(new Option('Stage ' + st.name, st.index, false, st.index === lobby.settings.stage));
    ss.disabled = !isHost;
    $('#btnStart').textContent = stageMode ? '開始闖關' : '開始對戰';

    const bg = $('#bgSelect');
    bg.innerHTML = '';
    bg.add(new Option('隨機場地', -1, false, lobby.settings.background === -1));
    for (const b of catalog.backgrounds) bg.add(new Option(b.name, b.id, false, b.id === lobby.settings.background));
    bg.disabled = !isHost;

    $('#hostCtl').classList.toggle('hidden', !isHost);
    $('#waitMsg').classList.toggle('hidden', isHost);
    $('#btnBot').disabled = lobby.players.length >= MAX_MEMBERS;
    if (lobby.state === 'playing') $('#waitMsg').textContent = '這局正在進行中…';
    else $('#waitMsg').textContent = '等待房主開始…';
  }

  function showSummary(m) {
    const body = $('#sumBody');
    body.innerHTML = '';
    for (const r of m.rows || []) {
      const tr = document.createElement('tr');
      const win = /^Win/.test(r[7]);
      const status = (win ? '勝利' : '落敗') + (/Alive/.test(r[7]) ? '（存活）' : '（陣亡）');
      tr.innerHTML = `<td><img src="${PACK + r[0]}"></td><td></td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6]}</td><td class="${win ? 'win' : ''}">${status}</td>`;
      tr.children[1].textContent = r[1];
      body.appendChild(tr);
    }
    $('#sumTime').textContent = m.time ? `時間 ${m.time}` : '';
    $('#sumTitle').textContent = m.title || '對戰結果';
    $('#summary').classList.remove('hidden');
  }

  $('#name').value = store.get('lf2-name') || '';
  $('#roomInput').value = new URLSearchParams(location.search).get('room') || '';
  $('#btnJoin').onclick = () => {
    initSound();
    $('#joinErr').textContent = '';
    const name = $('#name').value.trim();
    store.set('lf2-name', name);
    const join = () => send({ t: 'join', name, room: $('#roomInput').value.trim() });
    if (ws && ws.readyState === 1) join(); else connect(join);
  };
  for (const id of ['#name', '#roomInput']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
  $('#btnCopy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${lobby.room}`;
    try { await navigator.clipboard.writeText(url); $('#btnCopy').textContent = '已複製！'; } catch { prompt('把這個連結傳給朋友：', url); }
    setTimeout(() => { $('#btnCopy').textContent = '複製邀請連結'; }, 1500);
  };
  $('#btnBot').onclick = () => send({ t: 'bot' });
  $('#btnStart').onclick = () => send({ t: 'start' });
  $('#btnStop').onclick = () => send({ t: 'stop' });
  $('#bgSelect').onchange = () => send({ t: 'settings', background: Number($('#bgSelect').value) });
  $('#stageSelect').onchange = () => send({ t: 'settings', stage: Number($('#stageSelect').value) });
  for (const b of document.querySelectorAll('#modes button')) b.onclick = () => send({ t: 'settings', mode: b.dataset.mode });

  // ------------------------------------------------------------------ render
  function frame() {
    requestAnimationFrame(frame);
    if (mirror && inGame) mirror.render();
  }
  showPanel('join');
  requestAnimationFrame(frame);
})();
