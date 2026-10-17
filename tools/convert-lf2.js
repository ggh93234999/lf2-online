#!/usr/bin/env node
'use strict';
/*
 * Imports characters, objects and stage data from an original LF2
 * installation into the F.LF data pack used by this server.
 *
 *   node tools/convert-lf2.js <path-to-LF2-folder>
 *
 * The LF2 folder is the one containing lf2.exe, data/ and sprite/.
 * Output goes to packs/LF2_19 (data/*.js, sprite/*.png, sound/wav, extra.json, stage.json).
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { convert } = require('./data_file_converter');

const KEY = 'odBearBecauseHeIsVeryGoodSiuHungIsAGo';
const PACK = path.join(__dirname, '..', 'packs', 'LF2_19');

// LF2 type -> F.LF factory type. Types F.LF cannot simulate are left out.
const TYPE = { 0: 'character', 1: 'lightweapon', 2: 'heavyweapon', 3: 'specialattack', 4: 'lightweapon', 6: 'lightweapon' };

function decryptDat(file) {
  const b = fs.readFileSync(file);
  const out = Buffer.alloc(Math.max(0, b.length - 123));
  for (let i = 123; i < b.length; i++) out[i - 123] = (b[i] - KEY.charCodeAt((i - 123) % KEY.length) + 256) & 255;
  return out.toString('latin1').replace(/\r/g, '');
}

// ------------------------------------------------------------------ BMP -> PNG
function readBMP(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 2) !== 'BM') throw new Error('not a BMP: ' + file);
  const offset = b.readUInt32LE(10);
  const hsize = b.readUInt32LE(14);
  const w = b.readInt32LE(18);
  let h = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  const comp = b.readUInt32LE(30);
  const topDown = h < 0;
  h = Math.abs(h);
  let colors = b.readUInt32LE(46) || (bpp <= 8 ? 1 << bpp : 0);
  const pal = [];
  for (let i = 0; i < colors; i++) {
    const p = 14 + hsize + i * 4;
    pal.push([b[p + 2], b[p + 1], b[p]]);
  }
  const rgb = Buffer.alloc(w * h * 3);
  const put = (x, y, c) => {
    if (x >= w || y >= h) return;
    const row = topDown ? y : h - 1 - y;
    const o = (row * w + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };
  if (comp === 1 && bpp === 8) { // RLE8
    let p = offset, x = 0, y = 0;
    while (p < b.length && y < h) {
      const n = b[p++], v = b[p++];
      if (n > 0) { for (let i = 0; i < n; i++) put(x++, y, pal[v] || [0, 0, 0]); }
      else if (v === 0) { x = 0; y++; }
      else if (v === 1) break;
      else if (v === 2) { x += b[p++]; y += b[p++]; }
      else {
        for (let i = 0; i < v; i++) put(x++, y, pal[b[p++]] || [0, 0, 0]);
        if (v & 1) p++;
      }
    }
  } else if (comp === 0 && (bpp === 8 || bpp === 24 || bpp === 32)) {
    const stride = Math.ceil(w * bpp / 32) * 4;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = offset + y * stride + x * (bpp / 8);
        const c = bpp === 8 ? (pal[b[o]] || [0, 0, 0]) : [b[o + 2], b[o + 1], b[o]];
        put(x, y, c);
      }
    }
  } else {
    throw new Error(`unsupported BMP (${bpp} bpp, compression ${comp}): ${file}`);
  }
  return { w, h, rgb };
}

function bmpToPng(src, dest, transparentBlack) {
  const { w, h, rgb } = readBMP(src);
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], bl = rgb[i * 3 + 2];
    png.data[i * 4] = r; png.data[i * 4 + 1] = g; png.data[i * 4 + 2] = bl;
    png.data[i * 4 + 3] = transparentBlack && !r && !g && !bl ? 0 : 255;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, PNG.sync.write(png));
}

// ------------------------------------------------------------------ stage.dat
function parseStages(text) {
  const stages = [];
  const reStage = /<stage>([\s\S]*?)<stage_end>/g;
  let m;
  while ((m = reStage.exec(text))) {
    const body = m[1];
    const id = Number((/id:\s*(-?\d+)/.exec(body) || [])[1]);
    const phases = [];
    const rePhase = /<phase>([\s\S]*?)<phase_end>/g;
    let pm;
    while ((pm = rePhase.exec(body))) {
      const lines = pm[1].split('\n');
      const phase = { bound: 0, music: null, spawns: [] };
      for (let line of lines) {
        line = line.replace(/#.*$/, '').trim();
        if (!line) continue;
        const bound = /bound:\s*(-?\d+)/.exec(line);
        if (bound && !/\bid:/.test(line)) { phase.bound = Number(bound[1]); }
        const music = /music:\s*(\S+)/.exec(line);
        if (music) phase.music = music[1].replace(/\\/g, '/');
        if (!/\bid:/.test(line)) continue;
        const s = {};
        for (const [, k, v] of line.matchAll(/([a-z_]+):\s*(-?[\d.]+)/g)) s[k] = Number(v);
        if (/<boss>/.test(line)) s.boss = true;
        if (/<soldier>/.test(line)) s.soldier = true;
        phase.spawns.push(s);
      }
      // the first line of a phase holds the bound
      const fb = /bound:\s*(-?\d+)/.exec(pm[1]);
      if (fb) phase.bound = Number(fb[1]);
      phases.push(phase);
    }
    stages.push({ id, phases });
  }
  return stages.sort((a, b) => a.id - b.id);
}

// ------------------------------------------------------------------ main
function main() {
  const lf2 = process.argv[2];
  if (!lf2 || !fs.existsSync(path.join(lf2, 'data', 'data.txt'))) {
    console.error('用法：node tools/convert-lf2.js <LF2 資料夾（裡面有 data/ 和 sprite/）>');
    process.exit(1);
  }
  const existing = fs.readFileSync(path.join(PACK, 'data', 'data.js'), 'utf8');
  const haveIds = new Set([...existing.matchAll(/id:\s*(\d+)/g)].map(m => Number(m[1])));
  const dataTxt = fs.readFileSync(path.join(lf2, 'data', 'data.txt'), 'latin1');
  const objects = [];
  for (const [, id, type, file] of dataTxt.matchAll(/id:\s*(\d+)\s+type:\s*(\d+)\s+file:\s*(\S+)/g)) {
    objects.push({ id: Number(id), type: Number(type), file: file.replace(/\\/g, '/') });
  }

  const extra = [];
  const images = new Set();
  const sounds = new Set();
  for (const o of objects) {
    if (haveIds.has(o.id) || o.id === 0 || !TYPE[o.type]) continue;
    const src = path.join(lf2, o.file);
    if (!fs.existsSync(src)) { console.warn('找不到', src); continue; }
    const name = path.basename(o.file, '.dat');
    const js = convert(decryptDat(src));
    fs.writeFileSync(path.join(PACK, 'data', name + '.js'), js + '\n');
    for (const [, img] of js.matchAll(/"(sprite\/[^"]+\.png)"/g)) images.add(img);
    for (const [, snd] of js.matchAll(/sound:\s*"1\/([^"]+)"/g)) sounds.add(snd);
    const entry = { id: o.id, type: TYPE[o.type], file: 'data/' + name + '.js' };
    if (o.type === 0) {
      entry.name = (/name:\s*"([^"]+)"/.exec(js) || [])[1] || name;
      entry.pic = 'sprite/' + name + '_f.png';
      images.add(entry.pic);
    }
    extra.push(entry);
    console.log('資料', o.id, entry.type, name);
  }

  for (const img of images) {
    const base = path.basename(img, '.png');
    const bmp = path.join(lf2, 'sprite', 'sys', base + '.bmp');
    if (!fs.existsSync(bmp)) { console.warn('找不到圖片', bmp); continue; }
    const opaque = /_[fs]$/.test(base);
    bmpToPng(bmp, path.join(PACK, img), !opaque);
  }
  console.log('圖片', images.size, '張');

  // Sounds missing from the F.LF soundpack are copied as individual wav files
  const sp = fs.readFileSync(path.join(PACK, 'sound', 'soundpack.js'), 'utf8');
  const wavDir = path.join(PACK, 'sound', 'wav');
  fs.mkdirSync(wavDir, { recursive: true });
  let copied = 0;
  for (const s of sounds) {
    if (sp.includes(`"${s}"`)) continue;
    const src = path.join(lf2, 'data', s + '.wav');
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(wavDir, s + '.wav')); copied++; }
  }
  console.log('音效', copied, '個');

  fs.writeFileSync(path.join(PACK, 'extra.json'), JSON.stringify(extra, null, 1) + '\n');
  const stageFile = path.join(lf2, 'data', 'stage.dat');
  if (fs.existsSync(stageFile)) {
    const stages = parseStages(decryptDat(stageFile)).filter(s => s.id < 50); // 1-1 .. 5-5
    fs.writeFileSync(path.join(PACK, 'stage.json'), JSON.stringify(stages) + '\n');
    console.log('關卡', stages.length, '個');
  }
}

if (require.main === module) main();
module.exports = { decryptDat, readBMP, bmpToPng, parseStages };
