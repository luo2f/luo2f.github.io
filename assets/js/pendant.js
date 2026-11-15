/*!
 * 大肥鱼鼠标挂件（pendant）
 * 物理与渲染移植自 xiankuang.ovso.me 的 PendantPhysics（对应桌面版 exe 的 Form1.PhysicsEngine3.cs），
 * 常量与渲染顺序逐项对齐，视觉表现与参考站一致。
 */
(function () {
  'use strict';

  var CFG = window.__PENDANT_CFG__ || {};
  var SRC = CFG.src || '/assets/img/pendant/dafeiyu-pendant.gif';
  var STORE_KEY = 'pendant:on';

  /* ── manifest 默认值（dafeiyu-p_pendant.json） ─────────────────── */
  var META = {
    width: 88,
    height: 88,
    contentHeight: 64,
    imageSize: 48,
    ropeLength: 100,
    ropeSegments: 6,
    ropeColor: '#292955',
    gravity: 11000,
    anchorX: 0.6041667,
    anchorY: 0.4583333,
    cursorAnchorX: 0.59375,
    cursorAnchorY: 0.8125
  };
  (function () {
    var m = CFG.meta || {};
    for (var k in m) {
      if (Object.prototype.hasOwnProperty.call(m, k)) META[k] = m[k];
    }
  })();

  /* ── 常量：与 exe 完全一致 ─────────────────────────────────────── */
  var FIXED_STEP = 1 / 240;
  var MAX_FRAME_DELTA = 0.033;
  var MAX_STEPS_PER_TICK = 8;
  var VELOCITY_DAMPING = 0.993;
  var AIR_DAMPING = 0.96;
  var GRAVITY_SCALE = 0.864;
  var ANCHOR_VEL_TRANSFER = 0.225;
  var CONSTRAINT_PRESERVE = 0.88;
  var STRETCH_GUARD_RATIO = 1.18;
  var ABS_STRETCH_RATIO = 1.32;
  var LONG_SEG_REF = 18;
  var LONG_SEG_TIGHT = 1.1;
  var MAX_POINT_DELTA = 28;
  var MAX_PENDANT_DELTA = 38;
  var MIN_CONSTRAINT_ITER = 5;
  var CONSTRAINT_ITER = 10;
  var STRETCH_GUARD_ITER = 2;
  var LONG_SEG_MAX_EXTRA = 8;
  var REST_MOVE_THRESHOLD = 0.05;
  var REST_ANGLE_TOL = 1;
  var REST_DELAY = 0.3;
  var BASE_IMAGE_SIZE = 48;
  var BASE_CURSOR_SIZE = 32;

  /* ── Verlet 绳子物理（Pendant 模式） ──────────────────────────── */
  function PendantPhysics(opts) {
    // exe: GetPendulumSegmentCount() = max(1, ropeSegmentCount + 1)
    this.segments = Math.max(1, (opts.ropeSegments | 0) + 1);
    this.points = this.segments + 1;
    this.restLen = opts.restLen;
    this.gravity = opts.gravity;
    this.segLen = this.restLen / this.segments;

    var sizeRatio = Math.max(0.25, (opts.imageSize || BASE_IMAGE_SIZE) / BASE_IMAGE_SIZE);
    this.sizeMassScale = Math.min(2.2, Math.max(0.75, Math.sqrt(sizeRatio)));

    var n = this.points;
    this.ropeX = new Float64Array(n);
    this.ropeY = new Float64Array(n);
    this.ropeOldX = new Float64Array(n);
    this.ropeOldY = new Float64Array(n);

    this.anchorX = 0;
    this.anchorY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.prevAnchorX = 0;
    this.prevAnchorY = 0;
    this.accumulator = 0;
    this.stillSeconds = 0;
    this.frozenAtRest = false;

    this.reset();
  }

  PendantPhysics.prototype.reset = function () {
    for (var i = 0; i < this.points; i++) {
      this.ropeX[i] = this.anchorX;
      this.ropeY[i] = this.anchorY + this.segLen * i;
      this.ropeOldX[i] = this.ropeX[i];
      this.ropeOldY[i] = this.ropeY[i];
    }
    this.prevAnchorX = this.anchorX;
    this.prevAnchorY = this.anchorY;
    this.accumulator = 0;
    this.stillSeconds = 0;
    this.frozenAtRest = false;
  };

  PendantPhysics.prototype.setAnchor = function (x, y, instant) {
    if (instant) {
      var dx = x - this.anchorX;
      var dy = y - this.anchorY;
      this.anchorX = x;
      this.anchorY = y;
      this.targetX = x;
      this.targetY = y;
      this.prevAnchorX = x;
      this.prevAnchorY = y;
      for (var i = 0; i < this.points; i++) {
        this.ropeX[i] += dx;
        this.ropeY[i] += dy;
        this.ropeOldX[i] += dx;
        this.ropeOldY[i] += dy;
      }
    } else {
      this.targetX = x;
      this.targetY = y;
    }
  };

  PendantPhysics.prototype.nodes = function () {
    var out = [];
    for (var i = 0; i < this.points; i++) out.push({ x: this.ropeX[i], y: this.ropeY[i] });
    return out;
  };

  /* 姿态：位置 = 绳末端；角度 = 末段切线方向（挂件垂线与绳末端对齐） */
  PendantPhysics.prototype.pose = function () {
    var last = this.points - 1;
    var a = last - 1 >= 0 ? last - 1 : last;
    var dx = this.ropeX[last] - this.ropeX[a];
    var dy = this.ropeY[last] - this.ropeY[a];
    var angle = Math.atan2(dy, dx) - Math.PI / 2;
    if (!isFinite(angle)) angle = 0;
    return { x: this.ropeX[last], y: this.ropeY[last], angle: angle };
  };

  /* exe: AdvancePhysics(frameDelta) —— 固定步长 + 累加器 */
  PendantPhysics.prototype.advance = function (frameDelta) {
    if (!(frameDelta > 0)) return;

    this.accumulator += Math.min(frameDelta, MAX_FRAME_DELTA);
    var steps = Math.min(MAX_STEPS_PER_TICK, Math.floor(this.accumulator / FIXED_STEP));
    if (steps <= 0) return;

    var startX = this.anchorX;
    var startY = this.anchorY;
    var endX = isFinite(this.targetX) ? this.targetX : this.anchorX;
    var endY = isFinite(this.targetY) ? this.targetY : this.anchorY;

    for (var step = 1; step <= steps; step++) {
      var progress = step / steps;
      this.anchorX = startX + (endX - startX) * progress;
      this.anchorY = startY + (endY - startY) * progress;
      this._update(FIXED_STEP);
    }

    this.accumulator -= steps * FIXED_STEP;
    if (this.accumulator >= FIXED_STEP) this.accumulator = 0;
  };

  PendantPhysics.prototype._update = function (dt) {
    var last = this.points - 1;
    var moveX = this.anchorX - this.prevAnchorX;
    var moveY = this.anchorY - this.prevAnchorY;

    if (this._tryFreeze(moveX, moveY, dt)) return;

    this.ropeX[0] = this.anchorX;
    this.ropeY[0] = this.anchorY;
    this.ropeOldX[0] = this.anchorX - moveX * ANCHOR_VEL_TRANSFER;
    this.ropeOldY[0] = this.anchorY - moveY * ANCHOR_VEL_TRANSFER;
    this.prevAnchorX = this.anchorX;
    this.prevAnchorY = this.anchorY;

    this._integrate(last, dt);
    this._solveConstraints(this._constraintIterations(moveX, moveY));
    this._stretchGuard();
    this._pinAnchor();
    this._clampExtent(last);
  };

  PendantPhysics.prototype._integrate = function (pendantIndex, dt) {
    var eff = Math.min(0.997, Math.max(0.94, VELOCITY_DAMPING * AIR_DAMPING));
    var gStep = this.gravity * GRAVITY_SCALE * dt * dt;

    var inertiaBoost = Math.max(0, this.sizeMassScale - 1) * 0.035;
    var smallDrag = Math.max(0, 1 - this.sizeMassScale) * 0.008;
    var pendantDamping = Math.min(0.997, Math.max(0.94, eff + inertiaBoost - smallDrag));

    for (var i = 1; i < this.points; i++) {
      var isPendant = i >= pendantIndex;
      var damping = isPendant ? pendantDamping : eff;
      var grav = isPendant ? gStep * this.sizeMassScale : gStep;

      var vx = (this.ropeX[i] - this.ropeOldX[i]) * damping;
      var vy = (this.ropeY[i] - this.ropeOldY[i]) * damping;

      this.ropeOldX[i] = this.ropeX[i];
      this.ropeOldY[i] = this.ropeY[i];
      this.ropeX[i] += vx;
      this.ropeY[i] += vy + grav;

      this._clampVelocity(i, pendantIndex);
    }
  };

  PendantPhysics.prototype._clampVelocity = function (i, pendantIndex) {
    var vx = this.ropeX[i] - this.ropeOldX[i];
    var vy = this.ropeY[i] - this.ropeOldY[i];
    var maxDelta = i >= pendantIndex ? MAX_PENDANT_DELTA : MAX_POINT_DELTA;
    var len = Math.sqrt(vx * vx + vy * vy);
    if (len <= maxDelta || len <= 0.0001) return;
    var k = maxDelta / len;
    this.ropeOldX[i] = this.ropeX[i] - vx * k;
    this.ropeOldY[i] = this.ropeY[i] - vy * k;
  };

  PendantPhysics.prototype._constraintIterations = function (mx, my) {
    var it = Math.max(MIN_CONSTRAINT_ITER, CONSTRAINT_ITER);
    var move = Math.sqrt(mx * mx + my * my);
    if (move > 24) it += Math.min(8, Math.ceil((move - 24) / 26));
    if (this.segLen > LONG_SEG_REF) {
      var s = (this.segLen - LONG_SEG_REF) / LONG_SEG_REF;
      it += Math.min(LONG_SEG_MAX_EXTRA, Math.ceil(s * 4));
    }
    return it;
  };

  PendantPhysics.prototype._solveConstraints = function (iterations) {
    for (var iter = 0; iter < iterations; iter++) {
      this.ropeX[0] = this.anchorX;
      this.ropeY[0] = this.anchorY;
      for (var i = 0; i < this.points - 1; i++) {
        this._distanceConstraint(i, i + 1, this.segLen, CONSTRAINT_PRESERVE);
      }
    }
  };

  PendantPhysics.prototype._distanceConstraint = function (a, b, target, preserve) {
    var dx = this.ropeX[b] - this.ropeX[a];
    var dy = this.ropeY[b] - this.ropeY[a];
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 0.0001) return;

    var correction = (dist - target) / dist;
    var aWeight = a === 0 ? 0 : 0.5;
    var bWeight = a === 0 ? 1 : 0.5;
    var offX = dx * correction;
    var offY = dy * correction;

    if (a !== 0) {
      var ax = offX * aWeight;
      var ay = offY * aWeight;
      this.ropeX[a] += ax;
      this.ropeY[a] += ay;
      this.ropeOldX[a] += ax * preserve;
      this.ropeOldY[a] += ay * preserve;
    }
    var bx = -offX * bWeight;
    var by = -offY * bWeight;
    this.ropeX[b] += bx;
    this.ropeY[b] += by;
    this.ropeOldX[b] += bx * preserve;
    this.ropeOldY[b] += by * preserve;
  };

  PendantPhysics.prototype._guardRatio = function () {
    if (this.segLen <= LONG_SEG_REF) return STRETCH_GUARD_RATIO;
    var s = (this.segLen - LONG_SEG_REF) / LONG_SEG_REF;
    var drop = Math.min(STRETCH_GUARD_RATIO - LONG_SEG_TIGHT, s * 0.05);
    return STRETCH_GUARD_RATIO - drop;
  };

  PendantPhysics.prototype._stretchGuard = function () {
    var maxSeg = this.segLen * this._guardRatio();
    for (var iter = 0; iter < STRETCH_GUARD_ITER; iter++) {
      var adjusted = false;
      this.ropeX[0] = this.anchorX;
      this.ropeY[0] = this.anchorY;
      for (var i = 0; i < this.points - 1; i++) {
        var dx = this.ropeX[i + 1] - this.ropeX[i];
        var dy = this.ropeY[i + 1] - this.ropeY[i];
        if (dx * dx + dy * dy > maxSeg * maxSeg) {
          this._distanceConstraint(i, i + 1, maxSeg, 1);
          adjusted = true;
        }
      }
      if (!adjusted) break;
    }
  };

  PendantPhysics.prototype._pinAnchor = function () {
    this.ropeX[0] = this.anchorX;
    this.ropeY[0] = this.anchorY;
    this.ropeOldX[0] = this.anchorX;
    this.ropeOldY[0] = this.anchorY;
  };

  PendantPhysics.prototype._clampExtent = function (idx) {
    var dx = this.ropeX[idx] - this.anchorX;
    var dy = this.ropeY[idx] - this.anchorY;
    if (!isFinite(dx) || !isFinite(dy)) {
      this.reset();
      return;
    }
    var dist = Math.sqrt(dx * dx + dy * dy);
    var maxDist = Math.max(this.segLen, this.restLen * ABS_STRETCH_RATIO);
    if (dist <= maxDist || dist <= 0.0001) return;
    var sx = this.anchorX + (dx / dist) * maxDist;
    var sy = this.anchorY + (dy / dist) * maxDist;
    var mx = sx - this.ropeX[idx];
    var my = sy - this.ropeY[idx];
    this.ropeX[idx] = sx;
    this.ropeY[idx] = sy;
    this.ropeOldX[idx] += mx;
    this.ropeOldY[idx] += my;
  };

  PendantPhysics.prototype._isRestCandidate = function (mx, my) {
    if (Math.abs(mx) > REST_MOVE_THRESHOLD || Math.abs(my) > REST_MOVE_THRESHOLD) {
      this.stillSeconds = 0;
      this.frozenAtRest = false;
      return false;
    }
    var last = this.points - 1;
    var dx = this.ropeX[last] - this.anchorX;
    var dy = this.ropeY[last] - this.anchorY;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0.0001 || dy <= 0) {
      this.stillSeconds = 0;
      this.frozenAtRest = false;
      return false;
    }
    var tolCos = Math.cos((REST_ANGLE_TOL * Math.PI) / 180);
    if (dy / len >= tolCos) return true;
    this.stillSeconds = 0;
    this.frozenAtRest = false;
    return false;
  };

  PendantPhysics.prototype._freeze = function () {
    this.frozenAtRest = true;
    this._pinAnchor();
    for (var i = 0; i < this.points; i++) {
      this.ropeOldX[i] = this.ropeX[i];
      this.ropeOldY[i] = this.ropeY[i];
    }
    this.prevAnchorX = this.anchorX;
    this.prevAnchorY = this.anchorY;
  };

  PendantPhysics.prototype._tryFreeze = function (mx, my, dt) {
    if (!this._isRestCandidate(mx, my)) return false;
    if (this.frozenAtRest) {
      this._freeze();
      return true;
    }
    this.stillSeconds += Math.max(0, dt);
    if (this.stillSeconds < REST_DELAY) return false;
    this._freeze();
    return true;
  };

  /* ── 渲染 ─────────────────────────────────────────────────────── */
  // 与光标一致的尺寸规则：源图内容为 64px，按 dpr 取整数倍
  function scaleForDpr(dpr) {
    if (dpr <= 1) return 1;
    if (dpr <= 1.5) return 1.5;
    if (dpr <= 2) return 2;
    if (dpr <= 3) return 3;
    return Math.round(dpr);
  }

  var S = {
    on: false,
    ready: false,
    cv: null,
    ctx: null,
    img: null,
    btn: null,
    phys: null,
    cssW: 0,
    cssH: 0,
    ax: 0,
    ay: 0,
    offX: 0,
    offY: 0,
    dpr: 1,
    shapeScale: 1,
    raf: null,
    last: 0,
    mx: 0,
    my: 0,
    hasPointer: false,
    lastMove: 0,
    visible: false
  };

  var IDLE_STOP_MS = 1500;

  function build() {
    if (S.ready) return;
    S.ready = true;

    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var k = scaleForDpr(dpr);
    S.dpr = dpr;
    S.cssW = (META.width * k) / dpr;
    S.cssH = (META.height * k) / dpr;

    var cv = document.createElement('canvas');
    cv.id = 'pendant-rope';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText =
      'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;' +
      'width:100vw;height:100vh;';
    cv.width = Math.round(window.innerWidth * dpr);
    cv.height = Math.round(window.innerHeight * dpr);
    cv.style.width = window.innerWidth + 'px';
    cv.style.height = window.innerHeight + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var img = document.createElement('img');
    img.id = 'pendant-img';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.decoding = 'async';
    img.src = SRC;
    img.style.cssText =
      'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;' +
      'display:none;image-rendering:pixelated;-webkit-user-drag:none;' +
      'transform-origin:0 0;will-change:transform;width:' + S.cssW + 'px;height:' + S.cssH + 'px;';

    document.body.appendChild(cv);
    document.body.appendChild(img);

    S.cv = cv;
    S.ctx = ctx;
    S.img = img;

    // 挂点相对鼠标的偏移（右下）：exe 的 ratio × BaseCursorSize
    S.offX = META.cursorAnchorX * BASE_CURSOR_SIZE;
    S.offY = META.cursorAnchorY * BASE_CURSOR_SIZE;

    var shapeScale = (META.contentHeight || 64) / 64;
    if (!isFinite(shapeScale) || shapeScale <= 0) shapeScale = 1;
    S.shapeScale = shapeScale;

    // 挂件按 anchorX/anchorY 对齐绳末端（exe: Rotate 后 DrawImage(-ax*w, -ay*h)）
    S.ax = META.anchorX * S.cssW;
    S.ay = META.anchorY * S.cssH;

    S.phys = new PendantPhysics({
      imageSize: META.imageSize || BASE_IMAGE_SIZE,
      restLen: META.ropeLength * shapeScale,
      gravity: META.gravity * shapeScale,
      ropeSegments: META.ropeSegments
    });
  }

  function anchorPoint() {
    return { x: S.mx + S.offX, y: S.my + S.offY };
  }

  // 用 inline !important 写 transform：站长 SCSS 里针对 reduced-motion 的
  // \`* { transform: none !important }\` 之类的全局规则会盖掉普通 inline style，
  // 只有 inline !important 能压过样式表里的 !important。
  function setTransform(el, value) {
    if (el.style.setProperty) {
      el.style.setProperty('transform', value, 'important');
      el.style.setProperty('-webkit-transform', value, 'important');
    } else {
      el.style.transform = value;
    }
  }

  function render() {
    var pose = S.phys.pose();
    setTransform(
      S.img,
      'translate(' + pose.x + 'px,' + pose.y + 'px) ' +
        'rotate(' + pose.angle + 'rad) ' +
        'translate(' + -S.ax + 'px,' + -S.ay + 'px)'
    );

    var ctx = S.ctx;
    var nodes = S.phys.nodes();
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.strokeStyle = META.ropeColor || '#464646';
    ctx.lineWidth = Math.max(1, 3 * S.shapeScale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    if (nodes.length >= 4) {
      for (var i = 1; i < nodes.length - 1; i++) {
        var midX = (nodes[i].x + nodes[i + 1].x) / 2;
        var midY = (nodes[i].y + nodes[i + 1].y) / 2;
        ctx.quadraticCurveTo(nodes[i].x, nodes[i].y, midX, midY);
      }
      ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
    } else {
      for (var j = 1; j < nodes.length; j++) ctx.lineTo(nodes[j].x, nodes[j].y);
    }
    ctx.stroke();
  }

  function loop(now) {
    S.raf = null;
    if (!S.on || !S.phys) return;

    var dt = (now - S.last) / 1000;
    if (!(dt > 0)) dt = 0;
    S.last = now;

    var a = anchorPoint();
    S.phys.setAnchor(a.x, a.y);
    S.phys.advance(dt);
    render();

    // 静止后停掉 rAF：省电，也避免长期空转
    var idle = now - S.lastMove > IDLE_STOP_MS && S.phys.frozenAtRest;
    if (!idle) S.raf = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (!S.phys || !S.visible) return;
    if (S.raf) return;
    S.last = performance.now();
    S.raf = requestAnimationFrame(loop);
  }

  function show() {
    if (!S.on) return;
    build();
    if (S.visible) {
      startLoop();
      return;
    }
    var a = anchorPoint();
    S.phys.setAnchor(a.x, a.y, true);
    S.phys.reset();
    S.img.style.display = 'block';
    S.visible = true;
    S.lastMove = performance.now();
    render();
    startLoop();
  }

  function hide() {
    if (!S.visible) return;
    S.visible = false;
    if (S.raf) {
      cancelAnimationFrame(S.raf);
      S.raf = null;
    }
    S.img.style.display = 'none';
    S.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function onResize() {
    if (!S.ready) return;
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    S.dpr = dpr;
    S.cv.width = Math.round(window.innerWidth * dpr);
    S.cv.height = Math.round(window.innerHeight * dpr);
    S.cv.style.width = window.innerWidth + 'px';
    S.cv.style.height = window.innerHeight + 'px';
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.visible) render();
  }

  /* ── 开关按钮 ─────────────────────────────────────────────────── */
  var CSS =
    '#pendant-toggle{position:fixed;left:16px;bottom:16px;z-index:2147483645;width:40px;height:40px;' +
    'padding:0;border:0;border-radius:50%;background:rgba(127,127,127,.14);cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;opacity:.5;' +
    'transition:opacity .18s ease,transform .18s ease,background .18s ease;' +
    '-webkit-tap-highlight-color:transparent;}' +
    '#pendant-toggle:hover,#pendant-toggle:focus-visible{opacity:1;transform:translateY(-2px);background:rgba(127,127,127,.26);outline:none;}' +
    '#pendant-toggle img{width:26px;height:26px;display:block;image-rendering:pixelated;pointer-events:none;}' +
    '#pendant-toggle[aria-pressed="false"] img{filter:grayscale(1);opacity:.55;}' +
    'html[data-mode="dark"] #pendant-toggle,html[data-theme="dark"] #pendant-toggle{background:rgba(255,255,255,.1);}' +
    'html[data-mode="dark"] #pendant-toggle:hover,html[data-theme="dark"] #pendant-toggle:hover{background:rgba(255,255,255,.2);}' +
    '@media print{#pendant-toggle,#pendant-img,#pendant-rope{display:none !important;}}';

  function mountButton() {
    if (S.btn) return;
    if (!document.getElementById('pendant-toggle-style')) {
      var style = document.createElement('style');
      style.id = 'pendant-toggle-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var btn = document.createElement('button');
    btn.id = 'pendant-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', '大肥鱼挂件');
    btn.title = '大肥鱼挂件';

    var icon = document.createElement('img');
    icon.src = SRC;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);

    btn.addEventListener('click', function () {
      setOn(!S.on, true);
    });
    document.body.appendChild(btn);
    S.btn = btn;
    syncButton();
  }

  function syncButton() {
    if (!S.btn) return;
    S.btn.setAttribute('aria-pressed', S.on ? 'true' : 'false');
    S.btn.title = S.on ? '关掉大肥鱼挂件' : '召唤大肥鱼挂件';
    S.btn.setAttribute('aria-label', S.btn.title);
  }

  /* ── 状态 ─────────────────────────────────────────────────────── */
  function readStored() {
    try {
      var v = window.localStorage.getItem(STORE_KEY);
      return v === null ? null : v === '1';
    } catch (e) {
      return null;
    }
  }

  function writeStored(v) {
    try {
      window.localStorage.setItem(STORE_KEY, v ? '1' : '0');
    } catch (e) {
      /* 隐私模式下忽略 */
    }
  }

  function setOn(v, fromUser) {
    S.on = !!v;
    if (fromUser) writeStored(S.on);
    syncButton();
    if (!S.on) {
      hide();
      return;
    }
    if (S.hasPointer) show();
  }

  function init() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    mountButton();

    var stored = readStored();
    var on = stored !== null ? stored : !reduced && !coarse;

    /* 先记录指针位置，等到真正有 mousemove 再显示 */
    window.addEventListener(
      'mousemove',
      function (e) {
        S.mx = e.clientX;
        S.my = e.clientY;
        S.hasPointer = true;
        S.lastMove = performance.now();
        if (S.on && !S.visible) show();
        else if (S.on && !S.raf) startLoop();
      },
      { passive: true }
    );

    document.addEventListener('mouseleave', function () {
      hide();
    });
    window.addEventListener('blur', function () {
      hide();
    });
    window.addEventListener('resize', onResize);

    setOn(on, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
