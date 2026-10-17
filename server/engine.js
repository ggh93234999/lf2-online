'use strict';
// Boots the F.LF engine (AMD modules) inside Node with the browser-only
// pieces replaced by stubs, and exposes a small API to run matches headless.
const fs = require('fs');
const path = require('path');
const requirejs = require('requirejs');

global.__nodeRequire = require;

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine');
const PACK_DIR = path.join(ROOT, 'packs', 'LF2_19');
const PACK = '../packs/LF2_19/';

requirejs.config({
  baseUrl: ENGINE,
  nodeRequire: require,
  paths: {
    'LF/sprite-select': path.join(__dirname, 'netsprite'),
    'core/controller': path.join(__dirname, 'stubs', 'controller'),
    'LF/network': path.join(__dirname, 'stubs', 'network'),
    'core/support': path.join(__dirname, 'stubs', 'support'),
  },
});

const KEYS = ['up', 'down', 'left', 'right', 'def', 'jump', 'att'];

// Controller fed by network input; same interface as core/controller.
class NetController {
  constructor() {
    this.type = 'network';
    this.config = Object.fromEntries(KEYS.map(k => [k, k]));
    this.state = {};
    this.child = [];
    this.sync = true;
    this.buf = [];
    this.clear_states();
  }
  key(name, down) { if (KEYS.includes(name)) this.buf.push([name, down ? 1 : 0]); }
  clear_states() { for (const k of KEYS) this.state[k] = 0; }
  fetch() {
    for (const [I, down] of this.buf) {
      if (this.state[I] === down) continue;
      for (const c of this.child) c.key(I, down);
      this.state[I] = down;
    }
    this.buf.length = 0;
  }
  flush() { this.buf = []; }
  releaseAll() { for (const k of KEYS) if (this.state[k]) this.key(k, 0); }
}

function readJSON(name) {
  try { return JSON.parse(fs.readFileSync(path.join(PACK_DIR, name), 'utf8')); } catch { return null; }
}

// Objects imported from an original LF2 install by tools/convert-lf2.js
function addExtraObjects(pack) {
  const extra = readJSON('extra.json') || [];
  const objects = pack.data.object;
  const eager = [];
  for (const e of extra) {
    if (objects.some(o => o.id === e.id)) continue;
    const o = Object.assign({}, e);
    if (o.type === 'character' || o.type === 'specialattack') o.data = 'lazy';
    else eager.push(o);
    objects.push(o);
  }
  if (!eager.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    requirejs(eager.map(o => PACK + o.file.replace(/\.js$/, '')), (...datas) => {
      datas.forEach((d, i) => { eager[i].data = d; });
      resolve();
    }, reject);
  });
}

// F.LF guesses a character's dependencies by file name; also follow the
// object ids its frames actually spawn (opoint) so nothing is missing.
function addOpointDependencies(pack) {
  const objects = pack.data.object;
  const byId = new Map(objects.map(o => [o.id, o]));
  const cache = new Map();
  const oidsOf = o => {
    if (cache.has(o.id)) return cache.get(o.id);
    const ids = new Set();
    cache.set(o.id, ids);
    let text = '';
    try { text = fs.readFileSync(path.join(PACK_DIR, o.file), 'utf8'); } catch { return ids; }
    for (const [, id] of text.matchAll(/oid:\s*(\d+)/g)) ids.add(Number(id));
    return ids;
  };
  for (const ch of objects.filter(o => o.type === 'character')) {
    const pack = new Map((ch.pack || []).map(o => [o.id, o]));
    // start from everything already in the pack: their own spawns count too
    const queue = [ch, ...pack.values()];
    const seen = new Set(queue.map(o => o.id));
    while (queue.length) {
      for (const id of oidsOf(queue.shift())) {
        const dep = byId.get(id);
        if (!dep || seen.has(id)) continue;
        seen.add(id);
        if (dep.type === 'character') continue; // transformations are created on demand
        pack.set(id, dep);
        queue.push(dep);
      }
    }
    ch.pack = [...pack.values()];
  }
}

// How the imported items behave when held (F.LF's data/properties.js only covers its own items).
// Drink amounts are approximations of the original.
function addItemProperties(pack) {
  const spec = pack.data.properties.data;
  const throwable = { mass: 0.3, run_throw: true, jump_throw: true, dash_throw: false, stand_throw: false, just_throw: false };
  const add = (id, props) => { if (!spec[id]) spec[id] = Object.assign({}, throwable, props); };
  add(120, { attackable: true });                        // knife
  add(121, { just_throw: true });                        // baseball
  add(122, { drink: { hp: 100, mp: 100, hp_rate: 2, mp_rate: 2 } }); // milk
  add(123, { drink: { hp: 0, mp: 200, mp_rate: 4 } });   // beer
  add(124, { attackable: true, stand_throw: true });     // boomerang
}

let loaded = null;
function load() {
  if (loaded) return loaded;
  loaded = new Promise((resolve, reject) => {
    requirejs(['LF/sprite-select', 'LF/match', 'LF/global', 'LF/util', 'LF/loader!' + PACK],
      (Fsprite, Match, Global, util, pack) => {
        Fsprite.basePath = PACK_DIR;
        util.div = () => undefined; // no DOM on the server
        addExtraObjects(pack).then(() => {
          addItemProperties(pack);
          util.organize_package(pack);
          addOpointDependencies(pack);
          resolve({ Fsprite, Match, Global, util, pack, stages: readJSON('stage.json') || [] });
        }, reject);
      }, reject);
  });
  return loaded;
}

// The parts of F.LF's manager that a match touches, backed by a sprite World.
function createManager(E, world, hooks) {
  const UI = E.pack.data.UI.data;
  const GA = E.Global.application;
  E.Fsprite.current = world;
  const m = {};
  m.canvas = new E.Fsprite({ root: true, type: 'group', bgcolor: '#676767', wh: { w: GA.window.width, h: GA.window.height } });
  m.background_layer = new E.Fsprite({ canvas: m.canvas, type: 'group' });
  m.panel_layer = new E.Fsprite({ canvas: m.canvas, type: 'group', wh: { w: UI.panel.width, h: UI.panel.height } });
  for (let i = 0; i < 8; i++) {
    const pane = new E.Fsprite({ canvas: m.panel_layer, img: UI.panel.pic, wh: 'fit' });
    pane.set_x_y(UI.panel.pane_width * (i % 4), UI.panel.pane_height * Math.floor(i / 4));
  }
  const buffered = new Set();
  let t = 0;
  m.sound = {
    play(name) { if (name && !buffered.has(name)) { buffered.add(name); world.sounds.push(name); } },
    TU() { if (++t % 5 === 0) buffered.clear(); },
  };
  m.summary = {
    info: null, time: null,
    set_info(info) { this.info = info; },
    set_time(time) { this.time = time; },
    show() { hooks.onSummary && hooks.onSummary(this.info, this.time); },
    hide() { },
  };
  m.random = Math.random;
  m.match_end = () => { hooks.onEnd && hooks.onEnd(); };
  return m;
}

module.exports = { load, createManager, NetController, KEYS, PACK_DIR, ROOT };
