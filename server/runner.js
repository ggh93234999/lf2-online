'use strict';
// Runs one F.LF match headless and turns its sprite tree into network frames.
const { createManager, NetController } = require('./engine');

const round = v => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);

class MatchRunner {
  /**
   * opts.players: [{ id, name, char, team, bot, ai }]
   * opts.background: background id
   * hooks.onSummary(rows, time)
   */
  constructor(E, opts, hooks = {}) {
    this.E = E;
    this.world = new E.Fsprite.World();
    this.controllers = new Map();
    this.summary = null;
    this.hooks = hooks;
    E.Fsprite.current = this.world;
    this.manager = createManager(E, this.world, {
      onSummary: (rows, time) => { this.summary = { rows, time }; hooks.onSummary && hooks.onSummary(this.summary); },
    });
    this.match = new E.Match({ manager: this.manager, package: E.pack });
    const players = opts.players.map((p, i) => {
      let controller;
      if (p.bot) controller = { type: 'AIscript', id: p.ai || 1 };
      else {
        controller = new NetController();
        this.controllers.set(p.id, controller);
      }
      const pl = { name: p.name, controller, id: p.char, team: p.teamRaw || (p.team ? p.team : 10 + i) };
      if (p.pos) pl.pos = p.pos;
      if (p.spec) pl.spec = p.spec;
      return pl;
    });
    this.setup = { control: null, player: players, background: { id: opts.background }, set: { weapon: opts.weapons !== false } };
    // After the result shows, F.LF ends the match when attack/jump is pressed (F4).
    // On the server that would freeze everyone's screen, so hand it to the room instead.
    this.match.F4 = () => {
      if (this.continued) return;
      this.continued = true;
      if (hooks.onContinue) setImmediate(hooks.onContinue);
    };
    this.extra = opts.extra || null;
  }

  start() {
    this.match.create(this.setup);
    // load every AI script: clones and stage enemies may need any of them
    // and the transformation targets (Louis EX, fused Firzen) with their objects
    let aiReady = false;
    // (209: the ice ball the engine itself spawns when ice meets another projectile)
    const forms = [50, 51, 209].flatMap(id => {
      const o = this.E.pack.data.object.find(x => x.id === id);
      return o ? [id, ...(o.pack || []).map(p => p.id)] : [];
    });
    this.match.data.load({ AI: this.E.pack.data.AI.map(a => a.id), object: forms }, () => { aiReady = true; });
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        if (this.match.time && aiReady) return resolve();
        if (Date.now() - t0 > 15000) return reject(new Error('match failed to start'));
        setTimeout(poll, 20);
      };
      poll();
    });
  }

  input(memberId, key, down) {
    const c = this.controllers.get(memberId);
    if (c) c.key(key, down);
  }

  dropPlayer(memberId) {
    const c = this.controllers.get(memberId);
    if (c) c.releaseAll();
  }

  step() {
    this.E.Fsprite.current = this.world;
    try {
      this.match.frame();
      this.errors = 0;
    } catch (e) {
      // An engine error in one frame is usually harmless; give up only if it keeps happening
      this.errors = (this.errors || 0) + 1;
      if (this.errors === 1) console.warn('engine error:', e.stack.split('\n').slice(0, 3).join(' | '));
      if (this.errors > 30) throw e;
    }
    return this.flush();
  }

  flush() {
    const f = this.world.flush();
    for (const p of f.props) for (const k in p[1]) p[1][k] = round(p[1][k]);
    const out = { t: 'f', o: f.ops, p: f.props };
    if (this.world.sounds.length) { out.s = this.world.sounds; this.world.sounds = []; }
    return out;
  }

  full() {
    const f = this.world.full();
    return { t: 'full', o: f.ops, p: f.props };
  }

  destroy() {
    try { this.E.Fsprite.current = this.world; this.match.destroy(); } catch (e) { /* ignore */ }
  }
}

module.exports = { MatchRunner };
