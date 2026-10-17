'use strict';
// LF2 Stage mode on top of F.LF: runs stage.dat phases (1-1 .. 5-5) with
// the human players on one team against waves of computer enemies.
const { MatchRunner } = require('./runner');

const STAGE_BG = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 }; // Lion Forest, Stanley Prison, Great Wall, Queen's Island, Forbidden Tower
const HEROES = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]; // id 1000: random hero
const SOLDIERS = [30, 31];                     // id 3000: random soldier (Bandit / Hunter)
const PLAYER_TEAM = 1, ENEMY_TEAM = 2;
const SCREEN_W = 794;
const REVIVE_HP = 200;

const stageName = id => `${Math.floor(id / 10) + 1}-${(id % 10) + 1}`;
const rand = (a, b) => a + Math.random() * (b - a);

class StageRunner {
  /**
   * opts.players: room members [{ id, name, char, bot, ai }]
   * opts.stageIndex: index into E.stages to start from
   */
  constructor(E, opts, hooks = {}) {
    this.E = E;
    this.members = opts.players;
    this.index = opts.stageIndex || 0;
    this.aiId = opts.enemyAI || 1;
    this.hooks = hooks;
    this.runner = null;
    this.summary = null;
    this.out = [];       // messages to broadcast after this step
    this.carry = new Map(); // member id -> { hp, stat }
    this.busy = false;
  }

  get stage() { return this.E.stages[this.index]; }

  async start() { await this.loadSubStage(); }

  async loadSubStage() {
    this.busy = true;
    const st = this.stage;
    const group = Math.floor(st.id / 10) + 1;
    const players = this.members.map((m, i) => {
      const c = this.carry.get(m.id);
      const hp = c ? (c.hp > 0 ? c.hp : REVIVE_HP) : undefined;
      return {
        id: m.id, name: m.name, char: m.char, bot: m.bot, ai: m.ai, teamRaw: PLAYER_TEAM,
        pos: { x: 100 + (i % 4) * 70, y: 0, z: 0.3 + 0.15 * (i % 4) }, // z is fixed up after the background loads
        spec: hp !== undefined ? { health: { hp, hp_bound: Math.max(hp, 0) } } : undefined,
      };
    });
    const runner = new MatchRunner(this.E, { players, background: STAGE_BG[group], weapons: false });
    await runner.start();
    await this.preload(runner.match, st);
    if (this.runner) this.runner.destroy();
    this.runner = runner;
    this.setupMatch();
    this.out.push({ t: 'start' }, { t: 'banner', text: `Stage ${stageName(st.id)}`, ms: 2500 });
    this.busy = false;
  }

  // Load the data files of every enemy type this sub-stage can spawn.
  preload(match, st) {
    const ids = new Set();
    for (const ph of st.phases) {
      for (const s of ph.spawns) {
        if (s.id === 1000) HEROES.forEach(h => ids.add(h));
        else if (s.id === 3000) SOLDIERS.forEach(h => ids.add(h));
        else if (s.id < 100) ids.add(s.id);
      }
    }
    const objects = [...ids].flatMap(id => {
      const o = match.data.object.find(x => x.id === id);
      return o ? [id, ...(o.pack || []).map(p => p.id)] : [];
    });
    return new Promise(resolve => match.data.load({ object: objects, AI: [this.aiId] }, resolve));
  }

  setupMatch() {
    const m = this.runner.match;
    const bg = m.background;
    m.check_gameover = () => { }; // stage mode decides when the game ends
    this.humans = {};
    const chars = Object.entries(m.character);
    chars.forEach(([uid, ch], i) => {
      ch.stage_player = true;
      ch.member_id = this.members[i] && this.members[i].id;
      this.humans[uid] = ch;
      const z = bg.zboundary[0] + (bg.zboundary[1] - bg.zboundary[0]) * (0.25 + 0.17 * (i % 4));
      ch.set_pos(ch.ps.x, 0, z);
      const c = this.carry.get(ch.member_id);
      if (c) Object.assign(ch.stat, c.stat);
    });
    bg.camera_char = this.humans;
    this.t = 0;
    this.phaseIndex = -1;
    this.entries = [];
    this.waitUntil = 0;
    this.after = null;
    this.nextPhase();
  }

  nextPhase() {
    const m = this.runner.match;
    this.phaseIndex++;
    const ph = this.stage.phases[this.phaseIndex];
    m.background.camera_right = ph.bound;
    m.background.player_bound = ph.bound;
    const n = Math.max(1, this.members.length);
    this.entries = [];
    for (const s of ph.spawns) {
      if (s.id >= 100 && s.id < 200) { this.dropItem(s); continue; }
      if (s.id >= 200 && s.id !== 1000 && s.id !== 3000) continue; // criminal etc. are not simulated
      const count = s.ratio !== undefined ? Math.round(s.ratio * n) : 1;
      for (let k = 0; k < count; k++) {
        this.entries.push({ s, lives: s.times || 1, ch: null, uid: null, ai: [], deadAt: 0, respawnAt: this.t + k * 8 });
      }
    }
    this.hadBoss = this.entries.some(e => e.s.boss);
  }

  dropItem(s) {
    const m = this.runner.match;
    if (!m.data.object.some(o => o.id === s.id && o.data && o.data !== 'lazy')) return;
    const bg = m.background;
    const x = s.x !== undefined ? s.x + rand(-60, 60) : bg.camerax + rand(100, SCREEN_W - 100);
    m.create_weapon(s.id, { x, y: -300, z: rand(bg.zboundary[0], bg.zboundary[1]) });
  }

  spawn(e) {
    const m = this.runner.match;
    const bg = m.background;
    const s = e.s;
    let id = s.id;
    if (id === 1000) id = HEROES[(Math.random() * HEROES.length) | 0];
    if (id === 3000) id = SOLDIERS[(Math.random() * SOLDIERS.length) | 0];
    const camL = bg.camerax, camR = Math.min(bg.width, camL + SCREEN_W);
    let x;
    if (s.x !== undefined && s.x < 0) x = Math.max(10, camL - rand(30, 120));
    else if (s.x !== undefined) x = s.x + rand(-100, 100);
    else x = camR + rand(30, 140);
    x = Math.max(10, Math.min(bg.width - 10, x));
    const z = rand(bg.zboundary[0], bg.zboundary[1]);
    const before = new Set(Object.keys(m.character));
    const aiBefore = m.AIscript.length;
    const spec = { dir: x > this.playersX() ? 'left' : 'right' };
    if (s.hp) spec.health = { hp: s.hp, hp_bound: s.hp };
    m.create_characters([{ name: '', controller: { type: 'AIscript', id: this.aiId }, id, team: ENEMY_TEAM, pos: { x, y: s.y || 0, z }, spec }], { pane: false });
    e.uid = Object.keys(m.character).find(k => !before.has(k));
    e.ch = m.character[e.uid];
    e.ai = m.AIscript.slice(aiBefore);
    e.deadAt = 0;
    e.lives--;
  }

  playersX() {
    const hs = Object.values(this.humans);
    return hs.reduce((a, c) => a + c.ps.x, 0) / Math.max(1, hs.length);
  }

  removeEntryChar(e) {
    const m = this.runner.match;
    m.AIscript = m.AIscript.filter(a => !e.ai.includes(a));
    e.ch = null; e.uid = null; e.ai = []; e.removing = false;
  }

  bossAlive() {
    return this.entries.some(e => e.s.boss && ((e.ch && e.ch.health.hp > 0) || e.lives > 0));
  }

  // Advance the stage logic by one frame (after the match frame).
  director() {
    const m = this.runner.match;
    this.t++;
    if (this.after) {
      if (this.t >= this.after.at) { const fn = this.after.fn; this.after = null; fn(); }
      return;
    }
    const bossUp = this.bossAlive();
    for (const e of this.entries) {
      if (e.ch) {
        if (e.ch.health.hp <= 0) {
          if (!e.deadAt) e.deadAt = this.t;
          // let the body lie for a while, then take it off the field
          if (this.t - e.deadAt >= 75 && !e.removing) {
            e.removing = true;
            e.ch.sp.hide();
            e.ch.shadow.hide();
            m.AIscript = m.AIscript.filter(a => !e.ai.includes(a)); // stop its AI before the body goes
            m.destroy_object(e.ch);
          }
        }
        if (!e.ch.stage_entered) {
          const bg = m.background;
          if (e.ch.ps.x > bg.camerax + 20 && e.ch.ps.x < bg.player_bound - 20) e.ch.stage_entered = true;
        }
        if (!m.character[e.uid]) this.removeEntryChar(e);
        continue;
      }
      const canMore = e.lives > 0 || (e.s.soldier && bossUp);
      if (!canMore) { e.lives = 0; continue; }
      if (e.respawnAt === null) e.respawnAt = this.t + rand(30, 90);
      if (this.t >= e.respawnAt) {
        if (e.lives <= 0) e.lives = 1; // soldiers keep coming while a boss lives
        this.spawn(e);
        e.respawnAt = null;
      }
    }
    // the boss is down: soldiers stop coming and the ones left fall
    if (this.hadBoss && !bossUp) {
      for (const e of this.entries) {
        if (e.s.soldier) {
          e.lives = 0;
          if (e.ch && e.ch.health.hp > 0) this.knockOut(e.ch);
        }
      }
    }

    const humans = Object.values(this.humans);
    if (humans.every(h => h.health.hp <= 0)) {
      this.after = { at: this.t + 90, fn: () => this.finish(false) };
      this.out.push({ t: 'banner', text: 'GAME OVER', ms: 3000 });
      return;
    }
    const cleared = this.entries.every(e => (!e.ch || e.ch.health.hp <= 0) && e.lives <= 0);
    if (!cleared) return;
    if (this.phaseIndex + 1 < this.stage.phases.length) {
      this.nextPhase();
      this.out.push({ t: 'go' });
    } else {
      this.out.push({ t: 'banner', text: `Stage ${stageName(this.stage.id)} Clear!`, ms: 2500 });
      this.after = { at: this.t + 90, fn: () => this.stageClear() };
    }
  }

  // Make an enemy fall dead without being hit (the engine expects an attacker).
  knockOut(ch) {
    ch.health.hp = 0;
    if (!ch.itr.attacker) ch.itr.attacker = Object.values(this.humans)[0] || ch;
    ch.trans.frame(180, 20);
  }

  // Test helper: defeat every enemy currently on the field.
  debugClear() {
    for (const e of this.entries) {
      e.lives = 0;
      if (e.ch && e.ch.health.hp > 0) this.knockOut(e.ch);
    }
  }

  stageClear() {
    this.saveCarry();
    if (this.index + 1 >= this.E.stages.length) { this.finish(true); return; }
    this.index++;
    this.loadSubStage().catch(err => { console.error(err); this.finish(false); });
  }

  saveCarry() {
    for (const ch of Object.values(this.humans)) {
      this.carry.set(ch.member_id, { hp: Math.round(ch.health.hp), stat: Object.assign({}, ch.stat) });
    }
  }

  finish(won) {
    if (this.summary) return;
    const rows = Object.values(this.humans).map((ch, i) => {
      const m = this.members[i] || {};
      const alive = ch.health.hp > 0;
      return [ch.data.bmp.small, m.name || '', ch.stat.kill, ch.stat.attack, ch.health.hp_lost, ch.health.mp_usage, ch.stat.picking,
        (won ? 'Win' : 'Lose') + ' (' + (alive ? 'Alive' : 'Dead') + ')'];
    });
    const where = stageName(this.stage.id);
    this.summary = { rows, time: null, title: won ? '全部關卡通關！' : `闖關失敗（Stage ${where}）` };
    if (this.hooks.onSummary) this.hooks.onSummary(this.summary);
  }

  // ---- MatchRunner-compatible interface
  step() {
    const pre = this.out; // queued since the last step (e.g. a new sub-stage's 'start')
    this.out = [];
    if (this.busy || !this.runner) return pre;
    const frame = this.runner.step();
    if (!this.summary) this.director();
    const post = this.out;
    this.out = [];
    return [...pre, frame, ...post];
  }
  input(id, key, down) { if (this.runner) this.runner.input(id, key, down); }
  dropPlayer(id) { if (this.runner) this.runner.dropPlayer(id); }
  full() { return this.runner ? this.runner.full() : null; }
  destroy() { if (this.runner) this.runner.destroy(); this.runner = null; }
}

module.exports = { StageRunner, stageName };
