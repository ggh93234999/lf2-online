/*
 * Server-side drop-in for F.LF's core/sprite-canvas.
 * It renders nothing; it keeps the same sprite tree in memory and records
 * every structural change and dirty property, so the tree can be mirrored
 * in the browser (see public/mirror.js) and drawn with the real renderer.
 */
define(['module'], function (module) {
  const fs = global.__nodeRequire('fs')
  const path = global.__nodeRequire('path')

  const sizeCache = new Map()
  function imageSize(file) {
    if (sizeCache.has(file)) return sizeCache.get(file)
    let size = { w: 0, h: 0 }
    try {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(24)
      fs.readSync(fd, buf, 0, 24, 0)
      fs.closeSync(fd)
      if (buf.readUInt32BE(12) === 0x49484452) size = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } // PNG IHDR
    } catch (e) { /* missing image: zero size */ }
    sizeCache.set(file, size)
    return size
  }

  // A World owns one sprite tree (one per game room) and its pending changes.
  function World() {
    this.nextId = 1
    this.nodes = new Map()
    this.ops = []          // structural ops in order: ['c', id, kind] / ['a', parent, child] / ['r', parent, child]
    this.dirty = new Map() // id -> Set of dirty property names
    this.sounds = []
  }
  World.prototype.register = function (node, kind) {
    node._id = this.nextId++
    node._world = this
    this.nodes.set(node._id, node)
    this.ops.push(['c', node._id, kind])
  }
  World.prototype.mark = function (node, prop) {
    let s = this.dirty.get(node._id)
    if (!s) { s = new Set(); this.dirty.set(node._id, s) }
    s.add(prop)
  }
  const PROPS = ['x', 'y', 'z', 'w', 'h', 'img_x', 'img_y', 'x_flipped', 'y_flipped', 'hidden', 'opacity', 'bgcolor', 'text', 'textcolor', 'font']
  function propsOf(node, names) {
    const o = {}
    for (const k of names) {
      if (k === 'img') o.img = node.imgs
      else if (k === 'cur_img') o.cur_img = node.cur_img
      else o[k] = node[k]
    }
    return o
  }
  // Collect the changes since the last flush: [ops, [[id, props], ...]]
  World.prototype.flush = function () {
    const props = []
    for (const [id, set] of this.dirty) {
      const node = this.nodes.get(id)
      if (node) props.push([id, propsOf(node, set)])
    }
    const out = { ops: this.ops, props }
    this.ops = []
    this.dirty = new Map()
    return out
  }
  // Full state for a client joining mid-way.
  World.prototype.full = function () {
    const ops = []
    const props = []
    const visit = node => {
      for (const ch of node.children || []) {
        ops.push(['c', ch._id, ch.children ? 'g' : 's'])
        ops.push(['a', node._id, ch._id])
        const names = PROPS.filter(k => ch[k] !== undefined)
        if (ch.imgs) names.push('img', 'cur_img')
        props.push([ch._id, propsOf(ch, names)])
        visit(ch)
      }
    }
    for (const node of this.nodes.values()) {
      if (node._root) {
        ops.push(['c', node._id, 'g'], ['root', node._id])
        props.push([node._id, propsOf(node, PROPS.filter(k => node[k] !== undefined))])
        visit(node)
      }
    }
    return { ops, props }
  }
  World.prototype.removeNode = function (node) {
    this.nodes.delete(node._id)
    for (const ch of node.children || []) this.removeNode(ch)
  }

  sprite.World = World
  sprite.current = null // the world new root sprites are created in
  sprite._masterconfig = (module.config && module.config()) || {}
  sprite.renderer = 'canvas'
  sprite.masterconfig = function (c) { if (c) sprite._masterconfig = c; else return sprite._masterconfig }
  sprite.masterconfig_set = function (key, value) {
    if (!key || !value) return
    // Image sizes are known up front, so "all images loaded" happens right away
    if (key === 'onready') setImmediate(value)
    else sprite._masterconfig[key] = value
  }
  sprite.resolve_resource = function (res) { return res }
  sprite.preload_image = function () { }
  sprite.basePath = '' // filesystem directory that image paths are relative to

  function setter(name) {
    return function (v) { this[name] = v; this._world.mark(this, name) }
  }

  // ---------------------------------------------------------------- sprite
  function sprite(config) {
    config = config || {}
    if (config.type === 'group' || config.root) return new SpriteGroup(config)
    const world = config.canvas ? config.canvas._world : sprite.current
    world.register(this, 's')
    this.img = {}
    this.imgs = {}
    this.cur_img = null
    this.x = 0; this.y = 0; this.z = 0
    this.w = 0; this.h = 0
    this.img_x = 0; this.img_y = 0
    if (config.wh === 'fit') this.fit_to_img = true
    else if (typeof config.wh === 'object') this.set_wh(config.wh)
    if (config.xy) this.set_xy(config.xy)
    if (config.xywh) { this.set_xy(config.xywh); this.set_wh(config.xywh) }
    if (config.img) {
      if (typeof config.img === 'object') { for (const I in config.img) this.add_img(config.img[I], I) } else this.add_img(config.img, '0')
    }
    if (config.text) { this.set_text(config.text, '#000000', '10px monospace') }
    if (config.textcolor) this.set_text(null, config.textcolor)
    if (config.font) this.set_text(null, null, config.font)
    if (config.bgcolor) this.set_bgcolor(config.bgcolor)
    if (config.canvas) { config.canvas.attach(this); this.parent = config.canvas }
  }
  const S = sprite.prototype
  S.set_wh = function (P) { this.set_w_h(P.w, P.h) }
  S.set_w_h = function (w, h) { this.w = this.ow = w; this.h = this.oh = h; this._world.mark(this, 'w'); this._world.mark(this, 'h') }
  S.set_w = function (w) { this.w = this.ow = w; this._world.mark(this, 'w') }
  S.set_h = function (h) { this.h = this.oh = h; this._world.mark(this, 'h') }
  S.clip_to_cur_img = function () {
    const im = this.img[this.cur_img]
    if (!im) return
    this.w = Math.min(this.ow === undefined ? Infinity : this.ow, im.naturalWidth)
    this.h = Math.min(this.oh === undefined ? Infinity : this.oh, im.naturalHeight)
    this._world.mark(this, 'w'); this._world.mark(this, 'h')
  }
  S.set_xy = function (P) { this.set_x_y(P.x, P.y) }
  S.set_x_y = function (x, y) { this.x = x; this.y = y; this._world.mark(this, 'x'); this._world.mark(this, 'y') }
  S.set_flipx = setter('x_flipped')
  S.set_flipy = setter('y_flipped')
  S.set_z = function (z) { this.z = Math.round(z); this._world.mark(this, 'z') }
  S.set_bgcolor = setter('bgcolor')
  S.set_alpha = setter('opacity')
  S.set_text = function (text, textcolor, font) {
    if (text) { this.text = text; this._world.mark(this, 'text') }
    if (textcolor) { this.textcolor = textcolor; this._world.mark(this, 'textcolor') }
    if (font) { this.font = font; this._world.mark(this, 'font') }
  }
  S.add_img = function (imgpath, name) {
    const size = imageSize(path.join(sprite.basePath, imgpath))
    const listeners = []
    const img = {
      src: imgpath, naturalWidth: size.w, naturalHeight: size.h, width: size.w, height: size.h,
      addEventListener: (ev, fn) => { if (ev === 'load') listeners.push(fn) },
      removeEventListener: () => { },
    }
    // F.LF waits for image load events; fire them right away (sizes are known)
    setImmediate(() => { for (const fn of listeners) fn.call(img) })
    if (this.fit_to_img) { delete this.fit_to_img; this.set_w_h(size.w, size.h) }
    this.img[name] = img
    this.imgs[name] = imgpath
    this._world.mark(this, 'img')
    this.switch_img(name)
    return img
  }
  S.remove_img = function (name) {
    delete this.img[name]; delete this.imgs[name]
    this._world.mark(this, 'img')
    if (this.cur_img === name) { this.cur_img = null; this._world.mark(this, 'cur_img') }
  }
  S.switch_img = function (name) {
    this.cur_img = name
    this._world.mark(this, 'cur_img')
    this.clip_to_cur_img()
  }
  S.set_img_xy = function (P) { this.set_img_x_y(P.x, P.y) }
  S.set_img_x_y = function (x, y) { this.img_x = x; this.img_y = y; this._world.mark(this, 'img_x'); this._world.mark(this, 'img_y') }
  S.render = function () { }
  S.hide = function () { if (!this.hidden) { this.hidden = true; this._world.mark(this, 'hidden') } }
  S.show = function () { if (this.hidden) { this.hidden = false; this._world.mark(this, 'hidden') } }
  S.remove = function () {
    if (!this.removed && this.parent) { this.removed = true; this.parent.remove(this) }
  }
  S.attach = function () {
    if (this.removed) { this.parent.attach(this); this.removed = false }
  }

  // ---------------------------------------------------------------- group
  function SpriteGroup(config) {
    const parent = config.canvas
    const world = parent ? parent._world : sprite.current
    world.register(this, 'g')
    this.children = []
    this.x = 0; this.y = 0; this.z = 0
    this.w = 0; this.h = 0
    if (config.root || !parent) { this._root = true; world.ops.push(['root', this._id]) } else parent.attach(this)
    if (config.bgcolor) this.set_bgcolor(config.bgcolor)
    if (typeof config.wh === 'object') this.set_wh(config.wh)
    if (config.xywh) {
      let xywh = config.xywh
      if (Array.isArray(xywh)) xywh = { x: xywh[0], y: xywh[1], w: xywh[2], h: xywh[3] }
      this.set_xy(xywh); this.set_wh(xywh)
    }
  }
  const G = SpriteGroup.prototype
  G.set_wh = S.set_wh
  G.set_w_h = function (w, h) { this.w = w; this.h = h; this._world.mark(this, 'w'); this._world.mark(this, 'h') }
  G.set_w = function (w) { this.w = w; this._world.mark(this, 'w') }
  G.set_h = function (h) { this.h = h; this._world.mark(this, 'h') }
  G.set_xy = S.set_xy
  G.set_x_y = S.set_x_y
  G.set_flipx = function () { }
  G.set_flipy = function () { }
  G.set_z = S.set_z
  G.set_bgcolor = S.set_bgcolor
  G.set_alpha = S.set_alpha
  G.hide = S.hide
  G.show = S.show
  G.attach = function (sp) {
    this.children.push(sp)
    sp.parent = this
    this._world.ops.push(['a', this._id, sp._id])
    sp.set_z(this.children.length)
  }
  G.remove = function (sp) {
    const i = this.children.indexOf(sp)
    if (i !== -1) {
      this.children.splice(i, 1)
      this._world.ops.push(['r', this._id, sp._id])
    }
  }
  G.remove_all = function () {
    for (const sp of this.children) this._world.ops.push(['r', this._id, sp._id])
    this.children.length = 0
  }
  G.render = function () { }

  return sprite
})
