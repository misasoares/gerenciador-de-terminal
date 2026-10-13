// Base compartilhada dos vídeos do Gerenciador de Terminal. Tudo é função pura de t (ver composition-contract.md).
(function () {
  const q = new URLSearchParams(location.search);
  const format = q.get('format') || '9x16';
  const W = 1080, H = { '9x16': 1920, '4x5': 1350, '1x1': 1080, '16x9': 1080 }[format] || 1920;
  // zona segura em px (9:16: UI do TikTok/Reels cobre base e direita)
  const SAFE = format === '9x16' ? { x0: 72, x1: 920, y0: 236, y1: 1530 } : { x0: 64, x1: 1016, y0: 80, y1: H - 80 };
  const SH = SAFE.y1 - SAFE.y0;
  document.body.dataset.format = format;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const prog = (t, start, dur) => clamp((t - start) / dur);
  const ease = {
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outBack: (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2),
    // mola criticamente amortecida, forma fechada
    spring: (x) => (x <= 0 ? 0 : 1 - Math.exp(-7 * x) * (1 + 7 * x)),
  };
  // janela: 0→1 entrando em [a, a+din], 1→0 saindo em [b-dout, b]
  const win = (t, a, b, din = 0.3, dout = 0.25, e = ease.outExpo) =>
    t < a || t > b ? 0 : Math.min(e(prog(t, a, din)), dout ? 1 - ease.inCubic(prog(t, b - dout, dout)) : 1);
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

  // layout: Y(f) = posição vertical relativa à zona segura; K = escala de altura entre formatos
  const Y = (f) => SAFE.y0 + f * SH;
  const K = SH / 1330;

  const $ = (sel) => document.querySelector(sel);
  // posiciona um elemento .abs: x,y em px do quadro; s escala; o opacidade; r rotação (graus)
  function put(el, { x = 0, y = 0, s = 1, o = 1, r = 0, sx, ox = '0%', oy = '0%' } = {}) {
    if (typeof el === 'string') el = $(el);
    if (!el) return;
    el.style.transformOrigin = `${ox} ${oy}`;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${sx ?? s}, ${s})`;
    el.style.opacity = o;
    el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
  }
  // texto palavra a palavra: envolve cada palavra num span e revela por tempo
  function words(el) {
    if (typeof el === 'string') el = $(el);
    if (!el.dataset.split) {
      el.innerHTML = el.innerHTML.replace(/(<[^>]+>)|([^\s<]+)/g, (m, tag, w) => (tag ? tag : `<span class="w" style="display:inline-block">${w}</span>`));
      el.dataset.split = '1';
    }
    return [...el.querySelectorAll('.w')];
  }
  function reveal(spans, t, start, step = 0.12, dur = 0.28) {
    spans.forEach((sp, i) => {
      const p = ease.outExpo(prog(t, start + i * step, dur));
      sp.style.opacity = p; sp.style.transform = `translateY(${(1 - p) * 26}px)`;
      sp.style.visibility = p <= 0.001 ? 'hidden' : 'visible';
    });
  }

  // ---------------- áudio ----------------
  // Sintetizador mínimo em OfflineAudioContext. Mesma grade de BPM do visual.
  function Synth(sr, dur) {
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    const out = ctx.createGain(); out.gain.value = 1.0;
    // limitador final: o render grava Int16 e corta o que passa de 1
    const fin = ctx.createDynamicsCompressor(); fin.threshold.value = -3; fin.knee.value = 0; fin.ratio.value = 20; fin.attack.value = 0.001; fin.release.value = 0.1; fin.connect(ctx.destination);
    const master = ctx.createGain(); master.gain.value = 0.8; master.connect(comp).connect(lim).connect(out).connect(fin);
    const music = ctx.createGain(); music.gain.value = 0.55; music.connect(master);
    const sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
    const noiseBuf = (() => { const b = ctx.createBuffer(1, sr * 2, sr); const d = b.getChannelData(0); const r = rng(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; return b; })();
    const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const osc = (type, f, t, a, peak, d, out = sfx, f2) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d); env(g, t, a, peak, d); o.connect(g).connect(out); o.start(t); o.stop(t + a + d + 0.05); };
    const noise = (t, d, peak, type, f0, f1, out = sfx, q = 1) => { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + d); env(g, t, Math.min(0.01, d / 4), peak, d); s.connect(f).connect(g).connect(out); s.start(t, (t * 0.37) % 1); s.stop(t + d + 0.05); };
    const api = {
      ctx, music, sfx,
      kick: (t, v = 1) => osc('sine', 150, t, 0.002, 0.9 * v, 0.32, music, 42),
      hat: (t, v = 1) => noise(t, 0.05, 0.12 * v, 'highpass', 8000, null, music),
      snare: (t, v = 1) => { noise(t, 0.16, 0.35 * v, 'bandpass', 1800, null, music, 0.8); osc('triangle', 190, t, 0.002, 0.25 * v, 0.08, music); },
      bass: (t, f, d = 0.4, v = 1) => { osc('sawtooth', f, t, 0.01, 0.16 * v, d, music); osc('sine', f, t, 0.01, 0.35 * v, d, music); },
      pad: (t, freqs, d, v = 1) => freqs.forEach((f) => { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (f % 7) - 3; lp.type = 'lowpass'; lp.frequency.value = 1100; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035 * v, t + 0.4); g.gain.setValueAtTime(0.035 * v, t + d - 0.4); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(lp).connect(g).connect(music); o.start(t); o.stop(t + d + 0.05); }),
      tick: (t, v = 1) => { osc('square', 2400, t, 0.001, 0.05 * v, 0.02); noise(t, 0.02, 0.06 * v, 'highpass', 5000); },
      pop: (t, v = 1) => osc('sine', 520, t, 0.002, 0.35 * v, 0.09, sfx, 1100),
      click: (t, v = 1) => { noise(t, 0.015, 0.3 * v, 'bandpass', 3000, null, sfx, 2); osc('sine', 1600, t, 0.001, 0.12 * v, 0.03); },
      thump: (t, v = 1) => { osc('sine', 90, t, 0.003, 1.0 * v, 0.6, sfx, 38); noise(t, 0.25, 0.25 * v, 'lowpass', 900, 120); },
      whoosh: (t, d = 0.45, v = 1) => noise(t, d, 0.22 * v, 'bandpass', 400, 4500, sfx, 0.7),
      riser: (t, d = 1, v = 1) => { noise(t, d, 0.18 * v, 'bandpass', 300, 6000, sfx, 1.5); osc('sawtooth', 110, t, d * 0.9, 0.05 * v, 0.1, sfx, 440); },
      rewind: (t, d = 0.5, v = 1) => { noise(t, d, 0.2 * v, 'bandpass', 5000, 300, sfx, 3); osc('sawtooth', 900, t, 0.01, 0.06 * v, d, sfx, 120); },
      scribble: (t, d = 0.35, v = 1) => { const r = rng(Math.round(t * 1000)); for (let x = 0; x < d; x += 0.045) noise(t + x, 0.04, (0.12 + r() * 0.08) * v, 'bandpass', 2500 + r() * 2500, null, sfx, 4); },
      // música de fundo: kick/hats/bass/pad em lá menor (Am F C G), com cortes opcionais
      groove({ from = 0, to = dur, bpm = 120, mutes = [], kick = true, hats = true, bassOn = true, padOn = true } = {}) {
        const B = 60 / bpm, roots = [55, 43.65, 65.41, 49], chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 261.6, 329.6], [196, 246.9, 293.7]];
        const muted = (t) => mutes.some(([a, b]) => t >= a - 1e-6 && t < b);
        for (let i = 0; from + i * B < to; i++) {
          const t = from + i * B; if (muted(t)) continue;
          const bar = Math.floor(i / 4), c = bar % 4;
          if (kick) api.kick(t, i % 4 === 0 ? 1 : 0.75);
          if (kick && i % 4 === 2) api.snare(t, 0.6);
          if (hats) { api.hat(t + B / 2, 0.8); api.hat(t, 0.4); }
          if (bassOn) { api.bass(t, roots[c], B * 0.45); api.bass(t + B / 2, roots[c] * 2, B * 0.3, 0.6); }
          if (padOn && i % 8 === 0) api.pad(t, chords[c], Math.min(B * 8, to - t));
        }
      },
      // faixa real (mp3/wav) no lugar do groove. A faixa já vem masterizada, então
      // não passa pelo compressor dos efeitos. segs: [[t do vídeo, t da faixa], ...]
      // (cada trecho toca até o próximo; corte sempre em cima de uma batida).
      // breaks: [[de, até]] abafa a música (passa-baixa + volume) e reabre no fim.
      async track(url, { segs = [[0, 0]], breaks = [], gain = 0.5, fadeOut = 0.35, sfxGain = 0.65 } = {}) {
        const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
        const lp = ctx.createBiquadFilter(), g = ctx.createGain();
        lp.type = 'lowpass'; lp.Q.value = 0.9; lp.frequency.setValueAtTime(20000, 0);
        g.gain.setValueAtTime(gain, 0);
        for (const [a, b, f = 380, dip = 0.6] of breaks) {
          lp.frequency.setValueAtTime(20000, a); lp.frequency.exponentialRampToValueAtTime(f, a + 0.08);
          lp.frequency.setValueAtTime(f, b - 0.3); lp.frequency.exponentialRampToValueAtTime(20000, b);
          g.gain.setValueAtTime(gain, a); g.gain.linearRampToValueAtTime(gain * dip, a + 0.08);
          g.gain.setValueAtTime(gain * dip, b - 0.3); g.gain.linearRampToValueAtTime(gain, b);
        }
        g.gain.setValueAtTime(gain, dur - fadeOut); g.gain.linearRampToValueAtTime(0.0001, dur);
        lp.connect(g).connect(fin);
        const X = 0.012; // micro-crossfade entre trechos
        segs.forEach(([t0, off], i) => {
          const t1 = i + 1 < segs.length ? segs[i + 1][0] : dur;
          const s = ctx.createBufferSource(), sg = ctx.createGain();
          s.buffer = buf;
          sg.gain.setValueAtTime(t0 > 0 ? 0 : 1, Math.max(0, t0 - X)); sg.gain.linearRampToValueAtTime(1, t0 + (t0 > 0 ? X : 0));
          if (t1 < dur) { sg.gain.setValueAtTime(1, t1 - X); sg.gain.linearRampToValueAtTime(0, t1 + X); }
          s.connect(sg).connect(lp);
          const st = Math.max(0, t0 - X);
          s.start(st, Math.max(0, off - (t0 - st)), t1 - st + X);
        });
        sfx.gain.value = sfxGain;
      },
      render: () => ctx.startRendering(),
    };
    return api;
  }

  // Faixas do projeto (Artlist ou do usuário), medidas com scripts/analisa-musica.mjs.
  // Preencha por projeto: { id: { url: '../assets/musica/x.mp3', drop: 8.055, ... } }
  const MUSICA = {
    escura: { url: '../assets/musica/escura.mp3', bpm: 120, fase: 0.094, drop: 24.094 },
    leve: { url: '../assets/musica/leve-120.mp3', bpm: 120, fase: 0.044, drop: 32.044 },
  };
  // ?musica=escura|leve|synth; sem parâmetro, a faixa padrão do conceito
  const musica = (padrao) => { const m = q.get('musica') || padrao || Object.keys(MUSICA)[0]; return m && MUSICA[m] ? { id: m, ...MUSICA[m] } : null; };

  // sequência de imagens de uma gravação real (f00001.jpg…): o quadro sai só de t
  function seq(img, base, n, t, { fps = 30, from = 0, speed = 1 } = {}) {
    if (typeof img === 'string') img = $(img);
    const i = Math.max(0, Math.min(n - 1, Math.floor((t - from) * fps * speed + 1e-6)));
    const src = `${base}/f${String(i + 1).padStart(5, '0')}.jpg`;
    if (img.getAttribute('src') !== src) { img.setAttribute('src', src); pending.push(img.decode().catch(() => {})); }
    return i;
  }
  // decodificações em andamento: o __seek espera por elas (quadro grande decodifica depois do 'complete')
  const pending = [];
  const settle = () => Promise.all(pending.splice(0));

  // câmera sobre um recorte: cada chave [t, u, v, s] = o ponto (u, v) do recorte fica no centro da caixa (bw × bh) na escala s
  function cam(img, bw, bh, keys, t, e = ease.inOutCubic) {
    if (typeof img === 'string') img = $(img);
    let st = keys[keys.length - 1];
    if (t <= keys[0][0]) st = keys[0];
    else for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t < keys[i + 1][0]) {
      const x = e((t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]));
      st = [t, lerp(keys[i][1], keys[i + 1][1], x), lerp(keys[i][2], keys[i + 1][2], x), lerp(keys[i][3], keys[i + 1][3], x)];
    }
    img.style.transform = `translate(${bw / 2 - st[1] * st[3]}px, ${bh / 2 - st[2] * st[3]}px) scale(${st[3]})`;
    return st;
  }

  window.P = { seq, settle, cam, format, W, H, SAFE, SH, Y, K, clamp, lerp, prog, ease, win, rng, $, put, words, reveal, Synth, musica, MUSICA, BPM: 120, B: 0.5 };

  // preview no navegador (sem ?render): loop em tempo real
  window.addEventListener('load', () => {
    if (q.has('render')) return;
    const t0 = performance.now();
    const loop = () => { if (window.__seek) window.__seek(((performance.now() - t0) / 1000) % window.__DURATION); requestAnimationFrame(loop); };
    loop();
  });
})();
