// 骰子动画引擎：从单文件 HTML 移植而来，适配小程序 Canvas 2D。
// 差异：Path2D -> ctx.beginPath；requestAnimationFrame -> canvas.requestAnimationFrame；
//       Image -> canvas.createImage；Audio -> wx.createInnerAudioContext（由页面注入 play 回调）。

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, p) => a + (b - a) * p;
const pick = () => 1 + Math.floor(Math.random() * 6);
const LAST_FRAME = 35;
const TILE = 192;
const INTRO_LEN = 950; // 入场翻滚落地时长（ms），比原来的 620ms 轻微缩放明显得多

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// 与新版实景骰盅 H5 完全一致的骰子布局：以舞台比例坐标定位，尺寸随骰盅(cupScale)缩放。
// cupScale 由页面按骰盅显示宽度/舞台宽度传入，使骰子聚拢在骰盅正下方。
function layout(n, width, height, randomize, cupScale) {
  const scale = cupScale || .6;
  // 骰子放大系数：掀盖后骰子更大更清晰，size 与 pitch 等比放大避免拥挤
  const DICE_K = 1.25;
  const wide = height <= width * 1.12;
  const cx = .5;
  const cy = wide ? .45 : (width <= 390 ? .60 : (height > 960 ? .58 : .60));
  const columns = n === 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 3 : 4;
  const rows = Math.ceil(n / columns);
  const pitchX = (n <= 5 ? .18 : n <= 8 ? .11 : .09) * scale * DICE_K;
  const pitchY = (wide ? (n <= 5 ? .09 : n <= 8 ? .075 : .065)
    : (n <= 5 ? .18 : n <= 8 ? .13 : .11)) * scale * width / Math.max(1, height) * DICE_K;
  const size = (n === 1 ? .24 : n <= 2 ? .19 : n <= 5 ? .16 : n <= 8 ? .12 : .10) * scale * DICE_K;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / columns), used = Math.min(columns, n - row * columns);
    const jitter = randomize ? .008 : 0;
    slots.push({
      x: cx + (i % columns - (used - 1) / 2) * pitchX + (randomize ? (Math.random() - .5) * jitter : 0),
      y: cy + (row - (rows - 1) / 2) * pitchY + (randomize ? (Math.random() - .5) * jitter : 0),
      size: size * (randomize ? .92 + Math.random() * .16 : 1),
    });
  }
  return randomize ? shuffle(slots) : slots;
}

function createEngine(opts) {
  const canvas = opts.canvas;
  const ctx = opts.ctx;
  const play = opts.play || function () {};
  const onResolved = opts.onResolved || function () {};
  const onRollingChange = opts.onRollingChange || function () {};
  const reduced = !!opts.reduced;

  const images = [null, null, null, null, null, null];
  const imagesReady = [false, false, false, false, false, false];
  let values = [1, 2, 3, 4, 5];
  let places = [];
  let movement = null;
  let entrance = 0;
  let raf = null;
  let rolling = false;
  let width = 1, height = 1, dpr = 1;
  let cupScale = opts.cupScale || .6;
  let destroyed = false;

  function restPoint(p) {
    return { x: p.x * width, y: p.y * height, size: p.size * width, groundY: p.y * height + p.size * width * .26, lift: 0 };
  }
  function flightPoint(i, p) {
    const start = movement.from[i], end = movement.to[i], step = movement.steps[i], a = ease(p);
    const arch = Math.sin(Math.PI * p), sway = Math.min(width * .105, height * .068) * step.swing;
    const size = width * lerp(start.size, end.size, a);
    const x = width * lerp(start.x, end.x, a) + sway * arch;
    const planeY = height * lerp(start.y, end.y, a) + arch * step.drift * height * .022;
    const first = p < .72 ? p / .72 : 1, second = clamp((p - .72) / .19), third = clamp((p - .91) / .09);
    const lift = Math.min(height * .10, width * .155) * step.speed *
      (Math.sin(Math.PI * first) + .24 * Math.sin(Math.PI * second) + .066 * Math.sin(Math.PI * third));
    return { x, y: planeY - lift, size: size * (1 + .16 * arch), groundY: planeY + size * .26, lift };
  }
  function dieState(i, age) {
    // 入场动画：骰子从上方错峰翻滚落地，带帧切换与弹跳，让"3D 翻滚"一打开就可见
    if (!movement && entrance > 0) {
      const introAge = Date.now() - entrance;
      const stepDelay = i * Math.min(70, 340 / Math.max(1, values.length));
      const q = clamp((introAge - stepDelay) / (INTRO_LEN - stepDelay));
      if (q < 1) {
        const rest = restPoint(places[i]);
        const bounce = Math.sin(Math.PI * q) * Math.min(height * .06, width * .09);
        return Object.assign({}, rest, {
          y: lerp(rest.y - height * .34, rest.y, ease(q)) - bounce,
          size: rest.size * (.9 + .1 * ease(q)),
          face: values[i],
          frame: Math.round(LAST_FRAME * ease(q)),
          lift: Math.max(0, height * .34 * (1 - ease(q))) + bounce,
          p: q, i,
        });
      }
    }
    if (!movement) return Object.assign({}, restPoint(places[i]), { face: values[i], frame: LAST_FRAME, p: 1, i });
    const step = movement.steps[i], p = clamp((age - step.delay) / step.duration);
    if (movement.quiet) {
      return Object.assign({}, restPoint(p < .5 ? movement.from[i] : movement.to[i]),
        { face: p < .5 ? values[i] : movement.faces[i], frame: LAST_FRAME, p, i });
    }
    const split = .43;
    const outgoing = p < split;
    const phase = outgoing ? 1 - ease(p / split) : 1 - Math.pow(1 - (p - split) / (1 - split), 1.48);
    return Object.assign({}, flightPoint(i, p),
      { face: outgoing ? values[i] : movement.faces[i], frame: Math.round(LAST_FRAME * clamp(phase)), p, i });
  }
  function ellipse(x, y, rx, ry, angle, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), angle, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function shadow(d) {
    const airborne = d.lift / Math.max(1, width * .16);
    const x = d.x + d.size * .115 + d.lift * .48;
    const y = d.groundY + d.size * .008 + d.lift * .23;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(.18);
    ctx.scale(d.size * (.65 + .08 * airborne), d.size * (.26 + .12 * airborne));
    const g = ctx.createRadialGradient(0, 0, .06, 0, 0, 1);
    g.addColorStop(0, 'rgba(1,8,5,' + (.80 - .29 * airborne) + ')');
    g.addColorStop(.46, 'rgba(1,8,5,' + (.50 - .21 * airborne) + ')');
    g.addColorStop(1, 'rgba(1,8,5,0)');
    ellipse(0, 0, 1, 1, 0, g);
    ctx.restore();
  }
  function trail(d) {
    if (!movement || movement.quiet || d.p <= 0 || d.p >= 1) return;
    const p = d.p, step = movement.steps[d.i], power = Math.sin(Math.PI * p);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let strand = 0; strand < 2; strand++) {
      ctx.beginPath();
      let begin;
      for (let k = 0; k <= 23; k++) {
        const u = k / 23, q = Math.max(0, p - (1 - u) * .31), past = flightPoint(d.i, q);
        const angle = p * 8.2 + step.phase + (1 - u) * 2.95;
        const radius = d.size * (1 - u) * .72 * power, off = strand * (1 - u) * d.size * .036;
        const x = past.x + Math.cos(angle) * (radius + off);
        const y = past.y + Math.sin(angle) * (radius * .56 + off) + d.size * .19;
        if (!k) { ctx.moveTo(x, y); begin = { x, y }; } else ctx.lineTo(x, y);
      }
      const g = ctx.createLinearGradient(begin.x, begin.y, d.x + .1, d.y + d.size * .19);
      g.addColorStop(0, 'rgba(255,137,47,0)');
      g.addColorStop(.43, 'rgba(251,155,63,' + power * .65 + ')');
      g.addColorStop(1, 'rgba(255,224,158,' + power * .94 + ')');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(.8, width * .003) * (strand ? .6 : 1.5);
      ctx.shadowBlur = strand ? 0 : Math.min(9, width * .018);
      ctx.shadowColor = '#ff9c3e';
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const s of step.sparks) {
      const q = clamp(p - s.lag * .27), past = flightPoint(d.i, q);
      const plume = (.2 + s.lag) * d.size * .5;
      ctx.globalAlpha = power * (1 - s.lag * .8);
      ellipse(past.x + s.dx * plume, past.y + d.size * .24 + s.dy * plume,
        Math.max(.5, s.r * width * .0033), Math.max(.5, s.r * width * .0033), 0, '#ffcf87');
    }
    const land = clamp((p - .72) / .21);
    if (land > 0 && land < 1) {
      ctx.globalAlpha = (1 - land) * .74;
      ctx.strokeStyle = '#fed99b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(d.x, d.groundY, d.size * (.25 + .45 * land), d.size * (.09 + .13 * land), .04, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }
  function finishRoll(now, silent) {
    // 统一收尾：无论正常结束还是看门狗兜底，都把 rolling 复位，避免卡死后再也摇不动
    if (!movement) return;
    values = movement.faces;
    places = movement.to;
    movement = null;
    rolling = false;
    if (!silent) {
      onResolved(values.slice(), sum());
      onRollingChange(false);
      requestDraw();
    }
  }
  function draw() {
    raf = null;
    if (destroyed) return;
    // 小程序 canvas.requestAnimationFrame 回调时间戳是 performance 相对基准，
    // 与 Date.now() 不一致；统一用 Date.now() 保证 start/now 同一基准。
    const now = Date.now();
    // 看门狗：动画超时（正常时长 1.3~2s，留足余量到 5s）强制收尾，防止 rolling 卡死
    if (movement && now - movement.start >= movement.length + 3000) {
      finishRoll(now, false);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // 不用 img.complete：真机上该属性可能某帧突然变 false，导致 draw 提前返回、
    // 不再 requestDraw，动画循环永久中断、rolling 卡死。用 setImage 时置位的自有标志。
    if (!places.length || !imagesReady.every(Boolean)) return;
    if (movement && now - movement.start >= movement.length) finishRoll(now, false);
    const age = movement ? now - movement.start : 0;
    if (movement && !movement.landed && age >= movement.soundAt) {
      movement.landed = true;
      play('roll', .57);
    }
    const dice = values.map((_, i) => dieState(i, age));
    dice.forEach(shadow);
    dice.forEach(trail);
    dice.sort((a, b) => a.groundY - b.groundY);
    for (const d of dice) {
      const size = d.size;
      const source = images[d.face - 1];
      const sx = (d.frame % 6) * TILE, sy = Math.floor(d.frame / 6) * TILE;
      ctx.drawImage(source, sx, sy, TILE, TILE, d.x - size / 2, d.y - size / 2, size, size);
    }
    if (entrance && now - entrance >= INTRO_LEN + 340) entrance = 0;
    if (movement || entrance) requestDraw();
  }
  function requestDraw() {
    if (raf || destroyed) return;
    if (typeof canvas.requestAnimationFrame === 'function') {
      raf = canvas.requestAnimationFrame(draw);
    } else {
      raf = setTimeout(() => { raf = null; draw(Date.now()); }, 16);
    }
  }
  function sum() { return values.reduce((a, b) => a + b, 0); }

  return {
    setImage(index, img) { images[index] = img; imagesReady[index] = true; },
    allImagesReady() { return imagesReady.every(Boolean); },
    setCupScale(v) {
      if (!v || v === cupScale) return;
      cupScale = v;
      places = layout(values.length, width, height, false, cupScale);
      requestDraw();
    },
    resize(w, h, ratio) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      dpr = ratio || 1;
      if (!places.length) places = layout(values.length, width, height, false, cupScale);
      requestDraw();
    },
    start() {
      places = layout(values.length, width, height, false, cupScale);
      entrance = reduced ? 0 : Date.now();
      requestDraw();
    },
    roll() {
      if (rolling) return false;
      play('shake', .55);
      entrance = 0;
      const quiet = reduced;
      const steps = values.map((_, i) => ({
        delay: quiet ? 0 : i * Math.min(67, 220 / values.length),
        duration: quiet ? 130 : 1330 + Math.random() * 365,
        swing: Math.random(),
        drift: Math.random() * 2 - 1,
        speed: .84 + Math.random() * .29,
        phase: Math.random() * Math.PI * 2,
        sparks: Array.from({ length: 14 }, () => ({ lag: Math.random(), dx: Math.random() * 2 - 1, dy: Math.random() * 2 - 1, r: .4 + Math.random() })),
      }));
      movement = {
        start: Date.now(),
        from: places,
        to: layout(values.length, width, height, true, cupScale),
        faces: values.map(pick),
        steps,
        quiet,
        length: Math.max(...steps.map(s => s.delay + s.duration)),
        soundAt: quiet ? 65 : Math.min(...steps.map(s => s.delay + s.duration * .72)),
        landed: false,
      };
      rolling = true;
      onRollingChange(true);
      requestDraw();
      return true;
    },
    changeCount(delta, min, max) {
      if (rolling) return false;
      if (values.length + delta < min || values.length + delta > max) return false;
      if (delta > 0) values.push(pick()); else values.pop();
      places = layout(values.length, width, height, false, cupScale);
      play('tap', .28);
      requestDraw();
      return true;
    },
    // 自恢复：掷骰前调用，清掉任何卡住的 rolling 状态，保证下一次一定能掷
    kick() {
      const now = Date.now();
      if (movement && now - movement.start >= movement.length + 3000) finishRoll(now, false);
      else if (!movement && rolling) { rolling = false; onRollingChange(false); requestDraw(); }
    },
    // 强制复位：无条件清掉动画与 rolling，供「摇一摇等同点按钮」兜底重试
    forceReset() {
      movement = null;
      entrance = 0;
      rolling = false;
      onRollingChange(false);
      requestDraw();
    },
    getCount() { return values.length; },
    getValues() { return values.slice(); },
    getSum() { return sum(); },
    isRolling() { return rolling; },
    destroy() { destroyed = true; if (raf) { if (typeof canvas.cancelAnimationFrame === 'function') canvas.cancelAnimationFrame(raf); else clearTimeout(raf); raf = null; } },
  };
}

module.exports = { createEngine, pick };
