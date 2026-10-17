// Rebuilds the server's F.LF sprite tree in the browser and draws it with
// F.LF's own canvas renderer (core/sprite-canvas).
define(['core/sprite-canvas'], function (Fsprite) {
  const imageCache = new Map()
  function loadImage(src) {
    let img = imageCache.get(src)
    if (!img) {
      img = new Image()
      img.src = Fsprite.resolve_resource(src)
      imageCache.set(src, img)
    }
    return img
  }

  function Mirror(canvasEl) {
    this.el = canvasEl
    this.reset()
  }
  Mirror.preload = function (paths) { for (const p of paths) loadImage(p) }

  Mirror.prototype.reset = function () {
    this.nodes = new Map()
    this.root = null
    this.dirty = true
  }

  Mirror.prototype.apply = function (ops, props) {
    const N = this.nodes
    for (const op of ops) {
      switch (op[0]) {
        case 'c':
          if (!N.has(op[1])) N.set(op[1], op[2] === 'g' ? new Fsprite({ type: 'group' }) : new Fsprite({}))
          break
        case 'root': {
          const root = new Fsprite({ canvas: this.el, type: 'group' })
          N.set(op[1], root)
          this.root = root
          break
        }
        case 'a': {
          const p = N.get(op[1]), c = N.get(op[2])
          if (!p || !c) break
          if (p.children.indexOf(c) === -1) p.attach(c)
          c.parent = p
          c.removed = false
          break
        }
        case 'r': {
          const p = N.get(op[1]), c = N.get(op[2])
          if (p && c) { p.remove(c); c.removed = true }
          break
        }
      }
    }
    for (const [id, pr] of props) {
      const n = N.get(id)
      if (!n) continue
      if (pr.img) {
        n.img = {}
        for (const k in pr.img) n.img[k] = loadImage(pr.img[k])
      }
      for (const k in pr) {
        if (k === 'img') continue
        n[k] = pr[k]
        if (k === 'w') n.ow = pr[k]
        if (k === 'h') n.oh = pr[k]
      }
    }
    this.dirty = true
  }

  Mirror.prototype.render = function () {
    if (!this.root || !this.dirty) return
    this.dirty = false
    this.root.render()
  }

  return Mirror
})
