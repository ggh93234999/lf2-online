/*\
 * special attack
\*/

define(['LF/livingobject', 'LF/global', 'core/util'],
  function (livingobject, Global, Futil) {
    const GC = Global.gameplay

    /*\
     * specialattack
     [ class ]
    \*/
    const states =
    {
      generic: function (event, K) {
        const $ = this
        switch (event) {
          case 'TU':
            $.interaction()
            $.mech.dynamics()
            //  <YinYin> hit_a is the amount of hp that will be taken from a type 3 object they start with 500hp like characters it can only be reset with F7 or negative hits - once the hp reaches 0 the type 3 object will go to frame noted in hit_d - also kind 9 itrs (john shield) deplete hp instantly.
            if ($.frame.D.hit_a) {
              $.health.hp -= $.frame.D.hit_a
            }
            break

          case 'frame':
            if ($.frame.D.opoint) {
              $.match.create_object($.frame.D.opoint, $)
            }
            if (SPAWNERS[$.frame.D.hit_Fa]) {
              SPAWNERS[$.frame.D.hit_Fa].call($)
            }
            if ($.frame.D.sound) {
              $.match.sound.play($.frame.D.sound)
            }
            if ($.frame.N === 15) { // on ground
              $.trans.frame(1000)
            }
            break

          case 'frame_force':
          case 'TU_force':
            if ($.frame.D.hit_j) {
              const dvz = $.frame.D.hit_j - 50
              $.ps.vz = dvz
            }
            break

          case 'leaving':
            if ($.bg.leaving($, 200)) { // only when leaving far
              $.trans.frame(1000) // destroy
            }
            break

          case 'hit':
          case 'hit_others':
            $.match.sound.play($.data.bmp.weapon_broken_sound)
            break

          case 'die':
            $.trans.frame($.frame.D.hit_d)
            break
        }
        $.states['300X'].call($, event, K)
      },

      /*  State 300X - Ball States
        descriptions taken from
        http://lf-empire.de/lf2-empire/data-changing/reference-pages/182-states?showall=&start=29
      */
      '300X': function (event, K) {
        const $ = this
        switch (event) {
          case 'TU':
            /*  <zort> chasing ball seeks for 72 frames, not counting just after (quantify?) it's launched or deflected. Internally, LF2 keeps a variable keeping track of how long the ball has left to seek, which starts at 500 and decreases by 7 every frame until it reaches 0. while seeking, its maximum x speed is 14, and its x acceleration is 0.7; it can climb or descend, by 1 px/frame; and its maximum z speed is 2.2, with z acceleration .4. when out of seeking juice, its speed is 17. the -7 in the chasing algorithm comes from hit_a: 7.
          */
            if ($.frame.D.hit_Fa === 1 ||
              $.frame.D.hit_Fa === 2) {
              if ($.health.hp > 0) {
                $.chase_target()
              }
              if ($.health.hp > 0 && $.chasing.target) {
                const T = $.chasing.target
                const dx = T.ps.x - $.ps.x
                const dy = T.ps.y - $.ps.y
                const dz = T.ps.z - $.ps.z
                if ($.ps.vx * (dx >= 0 ? 1 : -1) < 14) {
                  $.ps.vx += (dx >= 0 ? 1 : -1) * 0.7
                }
                if ($.ps.vz * (dz >= 0 ? 1 : -1) < 2.2) {
                  $.ps.vz += (dz >= 0 ? 1 : -1) * 0.4
                }
                // $.ps.vy = (dy>=0?1:-1) * 1.0;
                $.switch_dir($.ps.vx >= 0 ? 'right' : 'left')
              }
            }
            if ($.frame.D.hit_Fa === 10) {
              $.ps.vx = ($.ps.vx > 0 ? 1 : -1) * 17
              $.ps.vz = 0
            }
            if (HOMING[$.frame.D.hit_Fa]) {
              $.homing($.frame.D.hit_Fa)
            }
            break
        }
      },

      // Special Attack Projectiles
      1002: function (event, ITR, att, attps, rect) {
        const $ = this
        switch (event) {
          case 'state_entry':
            $.nobounce = $.parent.ps.y == 0 // If the parent is on the ground, projections don't bounce
            break
          case 'hit_others':
            $.ps.vx = 0
            $.trans.frame(10)
            break

          case 'TU':
            var ps = $.ps
            if (!ps) break
            if (ps.y === 0 && ps.vy > 0) // fell onto ground
            {
              if ($.nobounce) $.trans.frame(1000) // destroy
              if (!$.nobounce && this.mech.speed() > GC.weapon.bounceup.limit) {  // bounceup
                $.trans.frame(10)
                ps.vy = GC.weapon.bounceup.speed.y
                if (ps.vx) { ps.vx = (ps.vx > 0 ? 1 : -1) * GC.weapon.bounceup.speed.x }
                if (ps.vz) { ps.vz = (ps.vz > 0 ? 1 : -1) * GC.weapon.bounceup.speed.z }
              }
            }
            break
        }
      },

      /*  <zort> you know that when you shoot a ball between john shields it eventually goes out the bottom? that's because when a projectile is spawned it's .3 pixels or whatever below its creator and whenever it bounces off a shield it respawns.
      */
      //  State    - Ball Flying is the standard state for attacks.  If the ball hits other attacks with this state, it'll go to the hitting frame (10). If it is hit by another ball or a character, it'll go to the the hit frame (20) or rebounding frame (30).
      3000: function (event, ITR, att, attps, rect) {
        const $ = this
        switch (event) {
          case 'hit_others':
            // check if att is ice or fire
            if (ITR.effect === 3 && att.type === 'specialattack' && att.state() === 3000 && att.frame.D.itr.effect !== 3 && att.frame.D.itr.effect !== 2) {
              // freeze ball hit another non freeze ball
              return
            }
            if (ITR.effect !== 3 && ITR.effect !== 2 && att.type === 'specialattack' && att.frame.D.itr.effect === 3) { // non freeze or fire ball hit another freeze ball
              $.ps.vx = 0
              $.trans.frame(1000)
              $.match.create_object({ kind: 1, x: 41, y: 50, action: 0, dvx: 0, dvy: 0, oid: 209, facing: 0 }, att)
              return true
            }
            $.ps.vx = 0
            $.trans.frame(10)
            break

          case 'hit': // hit by others
            if (att.team === $.team && att.type === 'specialattack' && ($.summoned || att.summoned)) {
              return false // summoned objects do not knock out their own side's objects
            }
            if ($.frame.D.itr.kind === 14) // ice column
            {
              $.trans.set_wait(0, 20) // go to break frame
              return true
            }
            if (att.team === $.team && att.ps.dir === $.ps.dir) {
              // can only attack objects of same team if head on collide
              return false
            }
            // check if att is ice or fire
            if ($.frame.D.itr.effect === 3 && att.type === 'specialattack' && att.state() === 3000 && att.frame.D.itr.effect !== 3 && att.frame.D.itr.effect !== 2) {
              // freeze ball hit by non freeze ball
              return true
            }
            if (att.type === 'specialattack') {
              if ($.frame.D.itr.effect !== 3 && $.frame.D.itr.effect !== 2 && ITR.effect === 3) { // non freeze or fire ball hit by freeze ball
                $.ps.vx = 0
                $.trans.frame(1000)
                $.match.create_object({ kind: 1, x: 41, y: 50, action: 0, dvx: 0, dvy: 0, oid: 209, facing: 0 }, att)
                return true
              }
              if (ITR.kind === 0) {
                $.ps.vx = 0
                $.trans.frame(20)
                return true
              }
            }
            if (att.state() === 19) // firerun destroys 3000 projectiles
            {
              $.ps.vx = 0
              $.trans.frame(20) // hit
              return true
            }
            if (ITR.kind === 0 ||
              ITR.kind === 9) // itr:kind:9 can deflect all balls
            {
              $.ps.vx = 0
              $.team = att.team
              $.trans.frame(30) // rebound
              $.trans.trans(); $.TU_update(); $.trans.trans(); $.TU_update() // transit and update immediately
              return true
            }
            break

          case 'state_exit':
            // ice column broke
            if ($.match.broken_list[$.id]) {
              $.brokeneffect_create($.id)
            }
            break
        }
      },

      //  State 3001 - Ball Flying / Hitting is used in the hitting frames, but you can also use this state directly in the flying frames.  If the ball hits a character while it has state 3001, then it won't go to the hitting frame (20).  It's the same for states 3002 through 3004.
      3001: function (event, K) {
        const $ = this
        switch (event) {
        }
      },

      3006: function (event, ITR, att, attps, rect) {
        const $ = this
        switch (event) {
          case 'hit_others':
            if (att.type === 'specialattack' &&
              (att.state() === 3005 || att.state() === 3006)) // 3006 can only be destroyed by 3005 or 3006
            {
              $.trans.frame(10)
              $.ps.vx = 0
              $.ps.vz = 0
              return true
            }
            break
          case 'hit': // hit by others
            if (ITR.kind === 9) // 3006 can only be reflected by shield
            {
              $.ps.vx *= -1
              $.ps.z += 0.3
              return true
            }
            if (att.type === 'specialattack' &&
              (att.state() === 3005 || att.state() === 3006)) // 3006 can only be destroyed by 3005 or 3006
            {
              $.trans.frame(20)
              $.ps.vx = 0
              $.ps.vz = 0
              return true
            }
            if (att.type === 'specialattack' &&
              att.state() === 3000) {
              $.ps.vx = ($.ps.vx > 0 ? -1 : 1) * 7 // deflect
              return true
            }
            if (ITR.kind === 0) {
              $.ps.vx = ($.ps.vx > 0 ? -1 : 1) * 1 // deflect a little bit
              if (ITR.bdefend && ITR.bdefend > GC.defend.break_limit) {
                $.health.hp = 0
              }
              return true
            }
            break
        }
      },

      15: function (event, K) // whirlwind
      {
        const $ = this
        switch (event) {
          case 'TU':
            $.ps.vx = $.dirh() * $.frame.D.dvx
            break
        }
      },

      x: function (event, K) {
        const $ = this
        switch (event) {
        }
      }
    }

    /*  Summoned / homing objects of the bosses and Jan (not in the original F.LF).
        In LF2 a "start" frame carrying one of these hit_Fa values summons
        objects, which then fly with another hit_Fa value:
          5 -> 4   Jan's angels: one per teammate, heal the one they reach
          6 -> 7   Jan's devils: one per enemy
          8 -> 12  Bat's bats: one per enemy, at least 3
          13 -> 14 Julian's skull
          9 -> 7   Firzen's disaster: fire/ice balls, one per enemy, at least 4
          11       Firzen's volcano: ground flames, ice columns and a disaster
        Counts and speeds follow the notes of Little Fighter Wemake
        (https://github.com/gimhol/Little-Fighter-Wemake); they are
        reconstructions, not values from official documentation. */
    const HOMING = {
      // target kind, max/accel for x, z, y
      4: { kind: 'friend', vx: 12, ax: 0.7, vz: 3.5, az: 0.4, vy: 6, ay: 0.6 },
      7: { kind: 'enemy', vx: 14, ax: 0.25, vz: 3.5, az: 0.25, vy: 8, ay: 0.25 },
      12: { kind: 'enemy', vx: 14, ax: 0.25, vz: 3.5, az: 0.125, vy: 4, ay: 0.125 },
      14: { kind: 'enemy', vx: 12, ax: 0.18, vz: 3.5, az: 0.05, vy: 2, ay: 0.1 }
    }
    const SPREAD_X = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    const SPREAD_Y = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8]
    const VOLCANO_FLAMES = [[0, 0], [-25, 0], [25, 0], [-50, 0], [50, 0], [-38, -15], [38, -15], [-38, 15], [38, 15], [10, 25], [-10, 25]]

    function pick($, list) {
      return list[Math.floor($.match.random() * list.length)]
    }
    // one entry per living enemy, but at least `min` (cycling through the enemies)
    function per_enemy($, min) {
      const foes = $.living('enemy')
      const n = Math.max(min, foes.length)
      const out = []
      for (let i = 0; i < n; i++) out.push(foes.length ? foes[i % foes.length] : null)
      return out
    }
    // x offset (relative to my facing) that puts a falling object above target t
    function above($, t) {
      return t ? (t.ps.x - $.ps.x) * $.dirh() + pick($, SPREAD_X) * 12 : pick($, SPREAD_X) * 20
    }
    function disaster($, dy) {
      per_enemy($, 4).forEach(function (t, i) {
        $.emit(i % 2 ? 222 : 221, { dx: above($, t), dy: dy || 0, vx: pick($, SPREAD_X) / 2, vy: pick($, SPREAD_Y), target: t })
      })
    }
    const SPAWNERS = {
      5: function () {
        const $ = this
        const allies = $.living('friend')
        ;(allies.length ? allies : [null]).forEach(function (t) {
          $.emit($.id, { vx: pick($, SPREAD_X), vy: -2, target: t })
        })
      },
      6: function () {
        const $ = this
        per_enemy($, 1).forEach(function (t) {
          $.emit($.id, { dx: above($, t), vx: pick($, SPREAD_X) / 2, vy: pick($, SPREAD_Y) / 2, target: t })
        })
      },
      8: function () {
        const $ = this
        per_enemy($, 3).forEach(function (t) {
          $.emit($.id, { vx: pick($, [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]), vz: pick($, [-2, -1, 0, 1, 2]), target: t })
        })
      },
      13: function () {
        const $ = this
        $.emit($.id, { action: 50, vx: 8, vz: ($.match.random() * 3 - 1.5), vy: ($.match.random() - 0.5), target: per_enemy($, 1)[0] })
      },
      9: function () { disaster(this) },
      11: function () {
        const $ = this
        disaster($, -79)
        $.emit(211, { action: 109 })
        VOLCANO_FLAMES.forEach(function (f, i) {
          $.emit(211, { action: 54, dx: f[0], dz: f[1], back: f[0] < 0 })
        })
        ;[-1, 0, 1].forEach(function (zs) {
          $.emit(212, { action: 100, dx: 95, dz: zs * 20, vz: zs * 4 })
          $.emit(212, { action: 100, dx: -85, dz: zs * 20, vz: zs * 4, back: true })
        })
      }
    }

    // living characters on my side ('friend') or the other side ('enemy')
    function living(kind) {
      const $ = this
      const out = []
      for (const i in $.match.character) {
        const c = $.match.character[i]
        if (c.health.hp <= 0) continue
        if ((c.team === $.team) === (kind === 'friend')) out.push(c)
      }
      return out
    }

    /* Create an object next to this one.
       opt: dx/dy/dz offsets and vx/vy/vz speeds (x is relative to my facing),
            action (default 1), back (face the other way), target (homing) */
    function emit(oid, opt) {
      const $ = this
      const parent = $.parent || $
      const sign = $.dirh()
      const back = !!opt.back
      $.match.tasks.push({
        task: 'create_object',
        parent: parent,
        opoint: { kind: 1, x: 0, y: 0, action: opt.action || 1, dvx: 0, dvy: 0, oid: oid, facing: back ? 1 : 0 },
        team: $.team,
        pos: { x: $.ps.x + sign * (opt.dx || 0), y: $.ps.y + (opt.dy || 0) },
        z: $.ps.z + (opt.dz || 0),
        dir: $.ps.dir,
        dvz: 0,
        setup: function (obj) {
          obj.ps.vx = sign * (back ? -1 : 1) * (opt.vx || 0)
          obj.ps.vy = opt.vy || 0
          obj.ps.vz = opt.vz || 0
          obj.homing_target = opt.target || null
          obj.summoned = true
        }
      })
    }

    function homing(code) {
      const $ = this
      const ps = $.ps
      if (!ps) return
      const H = HOMING[code]
      // Firzen's fire/ice balls burst on the ground; other chasers skim along it
      if (code === 7 && ps.y >= 0 && ps.vy >= 0 && $.state() === 3000) {
        if ($.data.frame[60]) {
          ps.y = 0; ps.vx = 0; ps.vy = 0; ps.vz = 0
          $.trans.frame(60, 20)
          return
        }
        ps.y = 0; ps.vy = 0
      }
      if ($.health.hp <= 0) return // out of homing power: fly straight on
      let T = $.homing_target
      if (!T || T.health.hp <= 0 || !$.match.character[T.uid]) {
        const list = $.living(H.kind)
        T = null
        let best = Infinity
        for (let i = 0; i < list.length; i++) {
          const d = Math.abs(list[i].ps.x - ps.x) + Math.abs(list[i].ps.z - ps.z)
          if (d < best) { best = d; T = list[i] }
        }
        $.homing_target = T
      }
      if (!T) return // nobody to chase: hover on
      const dx = T.ps.x - ps.x
      const dz = T.ps.z - ps.z
      const dy = (T.ps.y - 35) - ps.y
      const step = function (v, d, acc, max) {
        v += (d >= 0 ? 1 : -1) * acc
        return Math.max(-max, Math.min(max, v))
      }
      ps.vx = step(ps.vx, dx, H.ax, H.vx)
      ps.vz = step(ps.vz, dz, H.az, H.vz)
      ps.vy = step(ps.vy, dy, H.ay, Math.max(H.vy, Math.abs(ps.vy)))
      $.switch_dir(ps.vx >= 0 ? 'right' : 'left')
      // Jan's angel heals the teammate it reaches
      if (H.kind === 'friend' && Math.abs(dx) < 25 && Math.abs(dz) < 15 && Math.abs(dy) < 50) {
        T.heal(100)
        $.health.hp = 0
        $.trans.frame(1000, 30) // vanish (outranks the 'die' transition)
      }
    }

    // inherit livingobject
    function specialattack(config, data, thisID) {
      const $ = this
      // chain constructor
      livingobject.call($, config, data, thisID)
      // constructor
      $.team = config.team
      $.match = config.match
      $.health.hp = $.proper('hp') || GC.default.health.hp_full
      if (GC.specialattack_projectiles.indexOf(thisID) === -1) {
        $.mech.mass = 0
      }
      $.setup()
    }
    specialattack.prototype = new livingobject()
    specialattack.prototype.constructor = specialattack
    specialattack.prototype.states = states
    specialattack.prototype.type = 'specialattack'
    specialattack.prototype.living = living
    specialattack.prototype.emit = emit
    specialattack.prototype.homing = homing

    specialattack.prototype.init = function (config) {
      const pos = config.pos
      const z = config.z
      const parent_dir = config.dir
      const opoint = config.opoint
      const dvz = config.dvz
      const $ = this
      $.parent = config.parent
      $.mech.set_pos(0, 0, z)
      $.mech.coincideXY(pos, $.mech.make_point($.frame.D, 'center'))
      let dir
      let face = opoint.facing
      if (face >= 20) {
        face = face % 10
      }
      if (face === 0) {
        dir = parent_dir
      } else if (face === 1) {
        dir = (parent_dir === 'right' ? 'left' : 'right')
      } else if (face >= 2 && face <= 10) {
        dir = 'right'
      } else if (face >= 11 && face <= 19) { // adapted standard
        dir = 'left'
      }
      $.switch_dir(dir)

      $.trans.frame(opoint.action === 0 ? 999 : opoint.action)
      $.trans.trans()

      $.ps.vx = $.dirh() * opoint.dvx
      $.ps.vy = opoint.dvy
      $.ps.vz = $.frame.D.dvx ? dvz : 0
    }

    specialattack.prototype.interaction = function () {
      const $ = this
      const ITR = Futil.make_array($.frame.D.itr)

      if ($.team !== 0) {
        for (const j in ITR) {  // for each itr tag
          const vol = $.mech.volume(ITR[j])
          if ($.proper($.id, 'zwidth')) {
            vol.zwidth = $.proper($.id, 'zwidth')
          }
          if (!vol.zwidth) {
            vol.zwidth = 0
          }
          const hit = $.scene.query(vol, $, { tag: 'body' })
          for (const k in hit) {  // for each being hit
            if (ITR[j].kind === 0 ||
              ITR[j].kind === 9 || // shield
              ITR[j].kind === 15 || // whirlwind
              ITR[j].kind === 16) // whirlwind
            {
              if (!(hit[k].type === 'character' && hit[k].team === $.team)) // cannot attack characters of same team
              {
                if (!(ITR[j].kind === 0 && hit[k].type !== 'character' && hit[k].team === $.team && hit[k].ps.dir === $.ps.dir)) // kind:0 can only attack objects of same team if head on collide
                {
                  if (!$.itr.arest) {
                    if ($.attacked(hit[k].hit(ITR[j], $, { x: $.ps.x, y: $.ps.y, z: $.ps.z }, vol))) {  // hit you!
                      $.itr_arest_update(ITR)
                      $.state_update('hit_others', ITR[j], hit[k])
                      if (ITR[j].arest) {
                        break; // attack one enemy only
                      }
                      if (hit[k].type === 'character' && ITR[j].kind === 9) {
                        // hitting a character will cause shield to disintegrate immediately
                        $.health.hp = 0
                      }
                    }
                  }
                }
              }
            } else if (ITR[j].kind === 8) // heal
            {
              if (hit[k].type === 'character') // only affects character
              {
                if (hit[k].heal(ITR[j].injury)) {
                  $.trans.frame(ITR[j].dvx)
                }
              }
            }
          }
        }
      }
    }

    specialattack.prototype.hit = function (ITR, att, attps, rect) {
      const $ = this
      if ($.itr.vrest[att.uid]) {
        return false
      }

      if (ITR && ITR.vrest) {
        $.itr.vrest[att.uid] = ITR.vrest
      }
      return $.state_update('hit', ITR, att, attps, rect)
    }

    specialattack.prototype.attacked = function (inj) {
      return this.parent.attacked(inj)
    }
    specialattack.prototype.offset_attack = function (inj) {
      this.parent.offset_attack(inj)
    }
    specialattack.prototype.killed = function () {
      this.parent.killed()
    }

    specialattack.prototype.chase_target = function () {
      // selects a target to chase after
      const $ = this
      if ($.chasing === undefined) {
        $.chasing =
        {
          target: null,
          chased: {},
          query:
          {
            type: 'character',
            sort: function (obj) {
              const dx = obj.ps.x - $.ps.x
              const dz = obj.ps.z - $.ps.z
              let score = Math.sqrt(dx * dx + dz * dz)
              if ($.chasing.chased[obj.uid]) {
                score += 500 * $.chasing.chased[obj.uid] // prefer targets that are chased less number of times
              }
              return score
            }
          }
        }
      }
      $.chasing.query.not_team = $.team
      const targets = $.match.scene.query(null, $, $.chasing.query)
      const target = targets[0]
      $.chasing.target = target
      if (!target) return

      if ($.chasing.chased[target.uid] === undefined) {
        $.chasing.chased[target.uid] = 1
      } else {
        $.chasing.chased[target.uid]++
      }
    }

    return specialattack
  })
