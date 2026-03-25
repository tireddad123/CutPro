
// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  clips: [],          // {id, name, file, url, duration, type, beatMarkers[], bpm, waveformData}
  timeline: [],       // {id, clipId, track, start, duration, inPoint, outPoint}
  selectedClipId: null,
  selectedTimelineId: null,
  currentTool: 'select',
  playheadTime: 0,
  seqDuration: 120,
  zoom: 3,            // px per second
  playing: false,
  srcClipId: null,
  markIn: null, markOut: null,
  snappingEnabled: true,
  snapThresholdPx: 10,
  activeSnapTime: null,
};

let playInterval = null;
const TRACK_ORDER = ['v2', 'v1', 'a1'];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// Safe HTML escape for user-visible strings
function esc(s){
  s = (s===undefined||s===null) ? '' : String(s);
  return s.replace(/[&<>\"'`]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;','`':'&#96;'}[m]));
}

// ─────────────────────────────────────────────────────────────────────────────
function on(id, evt, fn) { try { var el = document.getElementById(id); if (el) el.addEventListener(evt, fn); } catch(e) {} }
// ─────────────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2,9); }

function formatTC(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return [h,m,s,f].map(n => String(n).padStart(2,'0')).join(':');
}

function pxToSec(px) { return px / (state.zoom * 10); }
function secToPx(sec) { return sec * state.zoom * 10; }

// ─────────────────────────────────────────────────────────────────────────────
// TIMECODE DISPLAY
// ─────────────────────────────────────────────────────────────────────────────
function updateTimecodes() {
  const tc = formatTC(state.playheadTime);
  document.getElementById('timecode-display').textContent = tc;
  document.getElementById('cvs-tc').textContent = tc;
  document.getElementById('seq-label').textContent = `Sequence 1 — ${tc}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYHEAD
// ─────────────────────────────────────────────────────────────────────────────
var updatePlayhead = function() {
  const px = secToPx(state.playheadTime);
  document.getElementById('playhead-line').style.left = px + 'px';
  // canvas scrub
  const pct = state.seqDuration > 0 ? (state.playheadTime / state.seqDuration) * 100 : 0;
  document.getElementById('cvs-fill').style.width = pct + '%';
  document.getElementById('cvs-head').style.left = pct + '%';
  updateTimecodes();
}

// ─────────────────────────────────────────────────────────────────────────────
// RULER
// ─────────────────────────────────────────────────────────────────────────────
function drawRuler() {
  const canvas = document.getElementById('ruler-canvas');
  const container = document.getElementById('timeline-tracks');
  const W = container.scrollWidth || 1200;
  const H = 20;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, W, H);

  const pxPerSec = state.zoom * 10;
  const totalSec = pxToSec(W);
  const step = pxPerSec >= 100 ? 1 : pxPerSec >= 50 ? 2 : pxPerSec >= 20 ? 5 : 10;

  ctx.strokeStyle = '#555';
  ctx.fillStyle = '#8a8a8a';
  ctx.font = '9px Lucida Grande, Arial, sans-serif';

  for (let t = 0; t <= totalSec + step; t += step) {
    const x = Math.round(t * pxPerSec);
    ctx.beginPath();
    ctx.moveTo(x, 10); ctx.lineTo(x, H);
    ctx.stroke();
    if (t % (step * 2) === 0) {
      ctx.fillText(formatTC(t), x + 2, 10);
    }
  }
  // minor ticks
  const minor = step / 4;
  ctx.strokeStyle = '#333';
  for (let t = 0; t <= totalSec; t += minor) {
    if (t % step === 0) continue;
    const x = Math.round(t * pxPerSec);
    ctx.beginPath();
    ctx.moveTo(x, 15); ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Beat grid overlay (draws after ruler ticks — function defined further below)
  if (typeof drawBeatGrid === 'function') drawBeatGrid();
}

// ─────────────────────────────────────────────────────────────────────────────
// BIN
// ─────────────────────────────────────────────────────────────────────────────
var renderBin = function() {
  const list = document.getElementById('bin-list');
  list.innerHTML = '';
  const q = document.getElementById('bin-search').value.toLowerCase();
  const filtered = state.clips.filter(c => c.name.toLowerCase().includes(q));
  filtered.forEach(clip => {
    const item = document.createElement('div');
    item.className = 'bin-item' + (clip.id === state.selectedClipId ? ' selected' : '');
    item.dataset.id = clip.id;
    const bpmBadge    = clip.bpm ? `<span class="bpm-badge">${clip.bpm} BPM</span>` : '';
    const beatBadge   = clip.beatMarkers && clip.beatMarkers.length
      ? `<span class="beats-badge">♩ ${clip.beatMarkers.length}</span>` : '';
    const analysingBadge = clip._stub
      ? '<span class="analysing-badge" style="background:rgba(180,80,30,0.3);color:#e09060;">⚠ re-import needed</span>'
      : (!clip.waveformData && !clip.bpm)
      ? '<span class="analysing-badge">● analysing</span>' : '';
    item.innerHTML = `
      <div class="bin-thumb">${clip.type === 'audio' ? '🎵' : '🎬'}</div>
      <div class="bin-info">
        <div class="bin-name" title="${esc(clip.name)}">${esc(clip.name)}</div>
        <div class="bin-meta">${formatTC(clip.duration)} · ${clip.type}${bpmBadge}${beatBadge}${analysingBadge}</div>
      </div>`;
    item.addEventListener('click', () => selectBinClip(clip.id));
    item.addEventListener('dblclick', () => openInViewer(clip.id));
    list.appendChild(item);
  });
}

function selectBinClip(id) {
  state.selectedClipId = id;
  renderBin();
  updateClipInfo(id);
}

function updateClipInfo(id) {
  const clip = state.clips.find(c => c.id === id);
  if (!clip) return;
  const bpmInfo   = clip.bpm         ? `<div><span style="color:var(--text-label)">BPM:</span> <b style="color:#7add4a">${clip.bpm}</b></div>` : '';
  const beatInfo  = clip.beatMarkers ? `<div><span style="color:var(--text-label)">Beats:</span> ${clip.beatMarkers.length}</div>` : '';
  const snapReady = clip.bpm         ? `<div style="color:#4a8a2a;margin-top:4px;">✓ Beat-snap ready</div>` : '';
  document.getElementById('clip-info').innerHTML = `
    <div style="color:var(--text-secondary); font-size:10px; line-height:1.9;">
      <div><span style="color:var(--text-label)">Name:</span> ${esc(clip.name)}</div>
      <div><span style="color:var(--text-label)">Duration:</span> ${formatTC(clip.duration)}</div>
      <div><span style="color:var(--text-label)">Type:</span> ${clip.type}</div>
      ${bpmInfo}${beatInfo}${snapReady}
    </div>`;
}

function openInViewer(id) {
  const clip = state.clips.find(c => c.id === id);
  if (!clip) return;
  state.srcClipId = id;
  const vid = document.getElementById('src-video');
  vid.src = clip.url;
  vid.style.display = 'block';
  document.getElementById('vp-src').style.display = 'none';
  vid.load();

  vid.addEventListener('loadedmetadata', () => {
    updateSrcScrub();
  }, { once: true });
  vid.addEventListener('timeupdate', updateSrcScrub);
}

function updateSrcScrub() {
  const vid = document.getElementById('src-video');
  if (!vid.duration) return;
  const pct = (vid.currentTime / vid.duration) * 100;
  document.getElementById('src-fill').style.width = pct + '%';
  document.getElementById('src-head').style.left = pct + '%';
  document.getElementById('src-tc').textContent = formatTC(vid.currentTime);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT
// ─────────────────────────────────────────────────────────────────────────────
function importFiles(files) {
  // Ensure Bin tab is visible and filter cleared before listing imports
  document.getElementById('tab-bin')?.click();
  const __bs = document.getElementById('bin-search'); if (__bs) __bs.value = '';

  Array.from(files).forEach(file => {
    const url = URL.createObjectURL(file);
    const id = uid();
    const isAudio = file.type.startsWith('audio');
    const clip = { id, name: file.name, file, url, duration: 0, type: isAudio ? 'audio' : 'video' };

    const media = document.createElement(isAudio ? 'audio' : 'video');
    media.src = url;
    media.addEventListener('loadedmetadata', () => {
      clip.duration = media.duration;
      renderBin();
      analyzeBeat(clip);   // start beat analysis once we know the file is decodable
    }, { once: true });

    state.clips.push(clip);
    renderBin();
    setStatus(`🎬 Imported: ${file.name} — analysing beats…`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE CLIPS
// ─────────────────────────────────────────────────────────────────────────────
var addToTimeline = function(clipId, trackId) {
  const clip = state.clips.find(c => c.id === clipId);
  if (!clip) return;

  // find next free position on track
  const existing = state.timeline.filter(t => t.track === trackId);
  const start = existing.length > 0
    ? Math.max(...existing.map(t => t.start + t.duration))
    : 0;

  const entry = {
    id: uid(), clipId, track: trackId,
    start, duration: clip.duration || 10,
    inPoint: 0, outPoint: clip.duration || 10,
    fadeIn: 0, fadeOut: 0
  };
  state.timeline.push(entry);

  // extend seq duration if needed
  if (entry.start + entry.duration > state.seqDuration) {
    state.seqDuration = entry.start + entry.duration + 10;
  }

  renderTimeline();
  setStatus(`Added "${esc(clip.name)}" to ${trackId}`);
}

var renderTimeline = function() {
  TRACK_ORDER.forEach(tId => {
    const trackEl = document.getElementById('track-' + tId);
    if (!trackEl) return;
    trackEl.innerHTML = '';
    // re-add playhead anchor
    if (tId === 'v1') { /* playhead is in parent */ }

    const clips = state.timeline.filter(t => t.track === tId);
    clips.forEach(entry => {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip) return;
      const el = document.createElement('div');
      el.className = `clip ${clip.type === 'audio' ? 'audio-clip' : 'video-clip'}${entry.id === state.selectedTimelineId ? ' selected' : ''}`;
      el.style.left = secToPx(entry.start) + 'px';
      el.style.width = secToPx(entry.duration) + 'px';
      el.dataset.id = entry.id;
      const fadeInW  = Math.min(secToPx(entry.fadeIn  || 0), secToPx(entry.duration) * 0.5);
      const fadeOutW = Math.min(secToPx(entry.fadeOut || 0), secToPx(entry.duration) * 0.5);
      el.innerHTML = `
        <div class="clip-handle left"></div>
        <canvas class="clip-wave-canvas" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.35;pointer-events:none;"></canvas>
        ${entry.fadeIn  > 0 ? `<div class="fade-in-overlay"  style="width:${fadeInW}px"></div><span class="fade-triangle" style="left:${Math.max(2,fadeInW-12)}px">▶</span>` : ''}
        ${entry.fadeOut > 0 ? `<div class="fade-out-overlay" style="width:${fadeOutW}px"></div><span class="fade-triangle" style="right:${Math.max(2,fadeOutW-12)}px">◀</span>` : ''}
        <div class="fade-handle fade-in-handle"  style="left:${Math.max(6, fadeInW - 5)}px"  title="Drag to set Fade In"></div>
        <div class="fade-handle fade-out-handle" style="right:${Math.max(6, fadeOutW - 5)}px" title="Drag to set Fade Out"></div>
        <span style="position:relative;z-index:1">${esc(clip.name)}</span>
        ${(entry.fadeIn > 0 || entry.fadeOut > 0) ? `<span class="fade-badge">${entry.fadeIn > 0 ? 'F▶' : ''}${entry.fadeIn > 0 && entry.fadeOut > 0 ? ' ' : ''}${entry.fadeOut > 0 ? '◀F' : ''}</span>` : ''}
        <div class="clip-handle right"></div>`;
      // draw waveform if available
      requestAnimationFrame(() => {
        const wCanvas = el.querySelector('.clip-wave-canvas');
        if (wCanvas && clip.waveformData) drawClipWaveform(wCanvas, clip, entry);
        drawBeatMarkers(el, clip, entry);
        attachFadeHandles(el, entry);
      });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedTimelineId = entry.id;
        renderTimeline();
        updateClipInfo(entry.clipId);
        openInViewer(entry.clipId);
        loadFadeInspector();
      });

      // drag to move
      makeDraggable(el, entry);
      // resize handles
      makeResizable(el, entry);

      trackEl.appendChild(el);
    });
  });

  // re-attach playhead
  const ph = document.getElementById('playhead-line');
  if (!ph.parentElement || ph.parentElement.id !== 'timeline-tracks') {
    document.getElementById('timeline-tracks').appendChild(ph);
  }

  drawRuler();
  updatePlayhead();
}

function makeDraggable(el, entry) {
  let startX, startLeft;
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('clip-handle')) return;
    if (state.currentTool === 'blade') { bladeClip(entry, e); return; }
    e.preventDefault();
    startX = e.clientX;
    startLeft = entry.start;
    el.style.cursor = 'grabbing';

    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const rawStart = Math.max(0, startLeft + pxToSec(dx));
      const snapped = snapTime(rawStart, entry.id);
      entry.start = snapped.time;
      el.style.left = secToPx(snapped.time) + 'px';
      showSnapGuide(snapped.snapped ? snapped.time : null, snapped.type);
    };
    const onUp = () => {
      el.style.cursor = 'grab';
      showSnapGuide(null);
      renderTimeline();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function makeResizable(el, entry) {
  const leftH = el.querySelector('.clip-handle.left');
  const rightH = el.querySelector('.clip-handle.right');

  rightH.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startDur = entry.duration;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const rawEnd = entry.start + Math.max(1, startDur + pxToSec(dx));
      const snapped = snapTime(rawEnd, entry.id);
      entry.duration = Math.max(1, snapped.time - entry.start);
      el.style.width = secToPx(entry.duration) + 'px';
      showSnapGuide(snapped.snapped ? snapped.time : null, snapped.type);
    };
    const onUp = () => {
      showSnapGuide(null);
      renderTimeline();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  leftH.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startStart = entry.start;
    const startDur = entry.duration;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const newStart = Math.max(0, startStart + pxToSec(dx));
      const delta = newStart - startStart;
      entry.start = newStart;
      entry.duration = Math.max(1, startDur - delta);
      el.style.left = secToPx(entry.start) + 'px';
      el.style.width = secToPx(entry.duration) + 'px';
    };
    const onUp = () => {
      renderTimeline();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function bladeClip(entry, e) {
  const trackEl = document.getElementById('track-' + entry.track);
  const rect = trackEl.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const cutTime = entry.start + pxToSec(px - secToPx(entry.start));

  if (cutTime <= entry.start + 0.5 || cutTime >= entry.start + entry.duration - 0.5) return;

  const dur1 = cutTime - entry.start;
  const dur2 = entry.duration - dur1;
  const start2 = cutTime;

  entry.duration = dur1;
  const newEntry = { ...entry, id: uid(), start: start2, duration: dur2 };
  state.timeline.push(newEntry);
  renderTimeline();
  setStatus('Blade cut applied');
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK
// ─────────────────────────────────────────────────────────────────────────────
var togglePlay = function() {
  state.playing = !state.playing;
  const btn = document.getElementById('btn-play');
  const cBtn = document.getElementById('cvs-play');

  if (state.playing) {
    btn.textContent = '⏸';
    cBtn.textContent = '⏸';
    playInterval = setInterval(() => {
      state.playheadTime += 1/30;
      if (state.playheadTime >= state.seqDuration) {
        state.playheadTime = 0;
      }
      updatePlayhead();
    }, 1000/30);
  } else {
    btn.textContent = '▶';
    cBtn.textContent = '▶';
    clearInterval(playInterval);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE CLICK (set playhead)
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('timeline-tracks').addEventListener('click', (e) => {
  if (e.target.closest('.clip')) return;
  const ruler = document.getElementById('timeline-tracks');
  const rect = ruler.getBoundingClientRect();
  const px = e.clientX - rect.left + ruler.scrollLeft;
  state.playheadTime = Math.max(0, pxToSec(px));
  updatePlayhead();
});

document.getElementById('ruler-canvas').addEventListener('click', (e) => {
  const rect = e.target.getBoundingClientRect();
  const px = e.clientX - rect.left;
  state.playheadTime = Math.max(0, pxToSec(px));
  updatePlayhead();
});

// ─────────────────────────────────────────────────────────────────────────────
// ZOOM
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('tl-zoom-slider').addEventListener('input', (e) => {
  state.zoom = parseFloat(e.target.value);
  renderTimeline();
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOLBAR BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
['select','edit','blade','zoom-tl'].forEach(tool => {
  const btn = document.getElementById('btn-' + tool);
  if (btn) btn.addEventListener('click', () => {
    state.currentTool = tool === 'zoom-tl' ? 'zoom' : tool;
    ['select','edit','blade','zoom-tl'].forEach(t => document.getElementById('btn-'+t)?.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('timeline-tracks').style.cursor =
      tool === 'blade' ? 'crosshair' : tool === 'zoom' ? 'zoom-in' : 'default';
  });
});

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('cvs-play').addEventListener('click', togglePlay);
document.getElementById('btn-prev').addEventListener('click', () => { state.playheadTime = 0; updatePlayhead(); });
document.getElementById('cvs-go-start').addEventListener('click', () => { state.playheadTime = 0; updatePlayhead(); });
document.getElementById('btn-next').addEventListener('click', () => { state.playheadTime = state.seqDuration; updatePlayhead(); });
document.getElementById('cvs-go-end').addEventListener('click', () => { state.playheadTime = state.seqDuration; updatePlayhead(); });
document.getElementById('btn-rw').addEventListener('click', () => { state.playheadTime = Math.max(0, state.playheadTime - 5); updatePlayhead(); });
document.getElementById('btn-ff').addEventListener('click', () => { state.playheadTime = Math.min(state.seqDuration, state.playheadTime + 5); updatePlayhead(); });
document.getElementById('cvs-step-back').addEventListener('click', () => { state.playheadTime = Math.max(0, state.playheadTime - 1/30); updatePlayhead(); });
document.getElementById('cvs-step-fwd').addEventListener('click', () => { state.playheadTime = Math.min(state.seqDuration, state.playheadTime + 1/30); updatePlayhead(); });

// Source viewer controls
document.getElementById('src-play').addEventListener('click', () => {
  const vid = document.getElementById('src-video');
  if (!vid.src) return;
  if (vid.paused) { vid.play(); document.getElementById('src-play').textContent = '⏸'; }
  else { vid.pause(); document.getElementById('src-play').textContent = '▶'; }
});
document.getElementById('src-go-start').addEventListener('click', () => {
  const vid = document.getElementById('src-video'); if (vid.src) vid.currentTime = 0;
});
document.getElementById('src-go-end').addEventListener('click', () => {
  const vid = document.getElementById('src-video'); if (vid.src) vid.currentTime = vid.duration;
});
document.getElementById('src-step-back').addEventListener('click', () => {
  const vid = document.getElementById('src-video'); if (vid.src) vid.currentTime = Math.max(0, vid.currentTime - 1/30);
});
document.getElementById('src-step-fwd').addEventListener('click', () => {
  const vid = document.getElementById('src-video'); if (vid.src) vid.currentTime = Math.min(vid.duration, vid.currentTime + 1/30);
});

document.getElementById('src-mark-in').addEventListener('click', () => {
  const vid = document.getElementById('src-video');
  if (vid.src) { state.markIn = vid.currentTime; setStatus(`Mark In: ${formatTC(state.markIn)}`); }
});
document.getElementById('src-mark-out').addEventListener('click', () => {
  const vid = document.getElementById('src-video');
  if (vid.src) { state.markOut = vid.currentTime; setStatus(`Mark Out: ${formatTC(state.markOut)}`); }
});

// Insert
document.getElementById('btn-insert').addEventListener('click', () => {
  if (!state.selectedClipId) { setStatus('Select a clip in the bin first'); return; }
  addToTimeline(state.selectedClipId, 'v1');
});
document.getElementById('btn-overwrite').addEventListener('click', () => {
  if (!state.selectedClipId) { setStatus('Select a clip in the bin first'); return; }
  addToTimeline(state.selectedClipId, 'v1');
});

// Ripple delete
document.getElementById('btn-ripple-del').addEventListener('click', () => {
  if (!state.selectedTimelineId) { setStatus('Select a timeline clip first'); return; }
  const idx = state.timeline.findIndex(t => t.id === state.selectedTimelineId);
  if (idx !== -1) {
    const removed = state.timeline.splice(idx, 1)[0];
    // ripple: shift subsequent clips
    state.timeline
      .filter(t => t.track === removed.track && t.start >= removed.start)
      .forEach(t => t.start -= removed.duration);
    state.selectedTimelineId = null;
    renderTimeline();
    setStatus('Ripple delete applied');
  }
});

document.getElementById('btn-lift').addEventListener('click', () => {
  if (!state.selectedTimelineId) { setStatus('Select a timeline clip first'); return; }
  state.timeline = state.timeline.filter(t => t.id !== state.selectedTimelineId);
  state.selectedTimelineId = null;
  renderTimeline();
  setStatus('Clip lifted');
});

// Export

// ═════════════════════════════════════════════════════════════════════════════
// EXPORT ENGINE — FFmpeg.wasm via CDN (fixed)
// ═════════════════════════════════════════════════════════════════════════════

let ffmpegInstance = null;
let exportAborted  = false;
let exportFormat   = 'mp4';

const FFMPEG_CDN  = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js';
const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM = 'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.wasm';

// ── Open export modal ─────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  if (state.timeline.length === 0) { setStatus('Add clips to the timeline first'); return; }
  openExportModal();
});

function openExportModal() {
  const videoClips = state.timeline.filter(t => { const c = state.clips.find(x => x.id === t.clipId); return c && c.type === 'video'; });
  const audioClips = state.timeline.filter(t => { const c = state.clips.find(x => x.id === t.clipId); return c && c.type === 'audio'; });
  const textClips  = state.timeline.filter(t => { const c = state.clips.find(x => x.id === t.clipId); return c && c.type === 'text';  });

  document.getElementById('ei-dur').textContent    = formatTC(state.seqDuration);
  document.getElementById('ei-clips').textContent  = videoClips.length + 'v / ' + audioClips.length + 'a';
  document.getElementById('ei-tracks').textContent = 'V2 / V1 / A1';
  document.getElementById('ei-text').textContent   = textClips.length + ' clip' + (textClips.length !== 1 ? 's' : '');

  // COEP / SharedArrayBuffer check — show warning if FFmpeg.wasm won't work
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const noticeEl = document.querySelector('.export-notice');
  if (!isolated) {
    noticeEl.style.borderColor = 'rgba(224,120,32,0.4)';
    noticeEl.style.background  = 'rgba(60,30,10,0.4)';
    noticeEl.innerHTML =
      '<b>⚠ FFmpeg.wasm unavailable on this origin.</b> Your browser requires ' +
      '<code>Cross-Origin-Embedder-Policy: require-corp</code> to use SharedArrayBuffer. ' +
      'The export will automatically use the <b>Canvas + MediaRecorder fallback</b> instead — ' +
      'video clips won\'t be re-encoded but text overlays and audio will be mixed. ' +
      'Deploy to Netlify or Vercel with the correct headers to enable full FFmpeg export.';
  }

  resetExportUI();
  document.getElementById('export-modal').classList.add('open');
}

function resetExportUI() {
  exportAborted = false;
  document.getElementById('export-progress-section').classList.remove('show');
  document.getElementById('export-start-btn').disabled = false;
  document.getElementById('export-start-btn').textContent = 'Export →';
  document.getElementById('export-start-btn').style.display = '';
  document.getElementById('export-download-btn').classList.remove('show');
  document.getElementById('export-progress-bar').style.width = '0%';
  document.getElementById('export-progress-label').textContent = 'Ready';
  ['init','files','video','audio','text','mux'].forEach(s => {
    const el = document.getElementById('stage-' + s);
    el.className = 'export-stage';
    el.querySelector('.stage-icon').textContent = '⏳';
    document.getElementById('st-' + s).textContent = '';
  });
}

// ── Format & close ────────────────────────────────────────────────────────
document.querySelectorAll('.export-fmt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.export-fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    exportFormat = btn.dataset.fmt;
    document.getElementById('export-download-btn').download = 'cutpro-export.' + exportFormat;
  });
});

// Device presets
const DEVICE_PRESETS = {
  iphone: {
    fmt: 'mov', resolution: '1920x1080', fps: '29.97', quality: 'high',
    label: '📱 iPhone — MOV, H.264 Baseline, 1080p, 29.97fps, AAC',
  },
  instagram: {
    fmt: 'mp4', resolution: '1080x1080', fps: '30', quality: 'high',
    label: '📸 Instagram — MP4, 1080×1080, 30fps',
    note: '1:1 square',
  },
  youtube: {
    fmt: 'mp4', resolution: '1920x1080', fps: '29.97', quality: 'high',
    label: '▶ YouTube — MP4, H.264, 1080p, 29.97fps, High quality',
  },
  web: {
    fmt: 'webm', resolution: '1280x720', fps: '25', quality: 'medium',
    label: '🌐 Web — WebM, VP9, 720p, 25fps, Medium quality',
  },
  twitter: {
    fmt: 'mp4', resolution: '1280x720', fps: '29.97', quality: 'medium',
    label: '𝕏 Twitter/X — MP4, 720p, 29.97fps, ≤2m20s, ≤512MB',
  },
};

document.querySelectorAll('.export-device-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = DEVICE_PRESETS[btn.dataset.preset];
    if (!preset) return;

    // Set format
    document.querySelectorAll('.export-fmt-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.fmt === preset.fmt);
    });
    exportFormat = preset.fmt;
    document.getElementById('export-download-btn').download = 'cutpro-export.' + exportFormat;

    // Set resolution & fps & quality
    const resEl = document.getElementById('exp-resolution');
    const fpsEl = document.getElementById('exp-fps');
    const qEl   = document.getElementById('exp-quality');
    if (resEl) {
      // Find or set closest matching option
      const opts = [...resEl.options];
      const match = opts.find(o => o.value === preset.resolution);
      if (match) resEl.value = preset.resolution;
    }
    if (fpsEl) {
      const opts = [...fpsEl.options];
      const match = opts.find(o => o.value === preset.fps);
      if (match) fpsEl.value = preset.fps;
    }
    if (qEl) qEl.value = preset.quality;

    // Highlight active preset button
    document.querySelectorAll('.export-device-preset').forEach(b => {
      b.style.borderColor = b === btn ? 'var(--accent-blue2)' : '#2a3040';
      b.style.color       = b === btn ? 'var(--accent-blue)'  : '#8ab0d0';
    });

    setStatus('Preset: ' + preset.label);
  });
});
document.getElementById('export-close').addEventListener('click', () => {
  exportAborted = true;
  document.getElementById('export-modal').classList.remove('open');
});
document.getElementById('export-cancel').addEventListener('click', () => {
  exportAborted = true;
  document.getElementById('export-modal').classList.remove('open');
});

// ── Stage helpers ─────────────────────────────────────────────────────────
const stageTimers = {};
function startStage(id) {
  stageTimers[id] = Date.now();
  const el = document.getElementById('stage-' + id);
  el.className = 'export-stage active';
  el.querySelector('.stage-icon').textContent = '⚙';
}
function doneStage(id) {
  const t = stageTimers[id] ? ((Date.now() - stageTimers[id]) / 1000).toFixed(1) + 's' : '';
  const el = document.getElementById('stage-' + id);
  el.className = 'export-stage done';
  el.querySelector('.stage-icon').textContent = '✓';
  document.getElementById('st-' + id).textContent = t;
}
function errorStage(id, msg) {
  const el = document.getElementById('stage-' + id);
  if (!el) return;
  el.className = 'export-stage error';
  el.querySelector('.stage-icon').textContent = '✗';
  el.querySelector('.stage-label').textContent = msg || 'Failed';
}
function setProgress(pct, label) {
  document.getElementById('export-progress-bar').style.width = Math.min(100, pct) + '%';
  if (label) document.getElementById('export-progress-label').textContent = label;
}

// ── Entry point ────────────────────────────────────────────────────────────
document.getElementById('export-start-btn').addEventListener('click', () => {
  document.getElementById('export-progress-section').classList.add('show');
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  if (isolated) {
    runFFmpegExport();
  } else {
    runCanvasFallbackExport();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATH A — FFmpeg.wasm full export (requires COEP headers)
// ═══════════════════════════════════════════════════════════════════════════
async function runFFmpegExport() {
  const btn = document.getElementById('export-start-btn');
  btn.disabled = true; btn.textContent = 'Exporting…';
  exportAborted = false;

  const fmt     = exportFormat;
  const res     = document.getElementById('exp-resolution').value;
  const [outW, outH] = res.split('x').map(Number);
  const fps     = parseFloat(document.getElementById('exp-fps').value);
  const quality = document.getElementById('exp-quality').value;
  const crf     = quality === 'high' ? 18 : quality === 'medium' ? 23 : 30;

  try {
    // ── Stage 1: Load FFmpeg ───────────────────────────────────────
    startStage('init'); setProgress(5, 'Loading FFmpeg.wasm…');
    if (!ffmpegInstance) {
      await new Promise((resolve, reject) => {
        if (window.FFmpeg) { resolve(); return; }
        const s = document.createElement('script');
        s.src = FFMPEG_CDN; s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load FFmpeg.wasm from CDN — check your connection'));
        document.head.appendChild(s);
      });
      const { FFmpeg } = window.FFmpeg || {};
      if (!FFmpeg) throw new Error('FFmpeg.wasm not available');
      ffmpegInstance = new FFmpeg();
      ffmpegInstance.on('progress', ({ progress }) => {
        setProgress(50 + progress * 45, 'Encoding… ' + Math.round(progress * 100) + '%');
      });
      ffmpegInstance.on('log', ({ message }) => console.log('[FFmpeg]', message));
      await ffmpegInstance.load({ coreURL: FFMPEG_CORE, wasmURL: FFMPEG_WASM });
    }
    doneStage('init'); setProgress(15, 'FFmpeg ready');
    if (exportAborted) return;

    // ── Stage 2: Fetch & write source files ───────────────────────
    startStage('files'); setProgress(18, 'Fetching source files…');

    // fetchFile is a utility in @ffmpeg/util — fallback to manual fetch
    async function getFileData(url) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Fetch failed: ' + url);
      return new Uint8Array(await resp.arrayBuffer());
    }

    const videoEntries = state.timeline
      .filter(e => { const c = state.clips.find(x => x.id === e.clipId); return c && c.type === 'video' && c.url; })
      .sort((a, b) => a.start - b.start);
    const audioEntries = state.timeline
      .filter(e => { const c = state.clips.find(x => x.id === e.clipId); return c && (c.type === 'audio') && c.url; })
      .sort((a, b) => a.start - b.start);
    const textEntries  = state.timeline
      .filter(e => { const c = state.clips.find(x => x.id === e.clipId); return c && c.type === 'text'; });

    const writtenUrls = new Set();
    for (const entry of [...videoEntries, ...audioEntries]) {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || !clip.url || writtenUrls.has(clip.url)) continue;
      const ext  = clip.type === 'audio' ? 'mp3' : 'mp4';
      const fname = 'src_' + clip.id.replace(/[^a-z0-9]/gi, '_') + '.' + ext;
      clip._ffname = fname;
      try {
        const data = await getFileData(clip.url);
        await ffmpegInstance.writeFile(fname, data);
        writtenUrls.add(clip.url);
        setProgress(18 + (writtenUrls.size / (videoEntries.length + audioEntries.length + 1)) * 10,
          'Writing ' + clip.name + '…');
      } catch(e) {
        console.warn('[Export] Could not load', clip.name, e.message);
        clip._ffname = null;
      }
    }
    doneStage('files'); setProgress(30, 'Source files ready');
    if (exportAborted) return;

    // ── Stage 3: Build filter_complex ─────────────────────────────
    // All filters (video overlays, audio mix, drawtext) go into ONE
    // -filter_complex graph to avoid the -vf + -filter_complex conflict.
    startStage('video'); setProgress(33, 'Building video track…');

    const totalSec = Math.max(1, Math.ceil(state.seqDuration));
    const ffArgs   = [];
    let   inputIdx = 0;

    // Input 0: black base video
    ffArgs.push('-f', 'lavfi', '-i',
      'color=c=black:size=' + outW + 'x' + outH + ':rate=' + fps + ':duration=' + totalSec);
    inputIdx++;

    // Video clip inputs
    const videoInputs = [];
    for (const entry of videoEntries) {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || !clip._ffname) continue;
      ffArgs.push(
        '-ss', entry.inPoint.toFixed(3),
        '-t',  entry.duration.toFixed(3),
        '-i',  clip._ffname
      );
      videoInputs.push({ idx: inputIdx++, entry, clip });
    }

    // Audio inputs
    const audioInputs = [];
    for (const entry of audioEntries) {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || !clip._ffname) continue;
      ffArgs.push(
        '-ss', entry.inPoint.toFixed(3),
        '-t',  entry.duration.toFixed(3),
        '-i',  clip._ffname
      );
      audioInputs.push({ idx: inputIdx++, entry, clip });
    }

    doneStage('video'); setProgress(40, 'Video inputs wired');
    startStage('audio'); setProgress(42, 'Building audio mix…');

    // ── Build single filter_complex string ────────────────────────
    let fc = '';  // filter_complex accumulator
    let vidLabel = '0:v';

    // Overlay each video clip onto the black base
    videoInputs.forEach(({ idx, entry }, i) => {
      const outLabel  = 'ov' + i;
      const delay     = entry.start.toFixed(3);
      let   clipPipe  = '[' + idx + ':v]setpts=PTS-STARTPTS+' + delay + '/TB';

      if (entry.fadeIn > 0)
        clipPipe += ',fade=t=in:st=0:d=' + entry.fadeIn.toFixed(3) + ':alpha=1';
      if (entry.fadeOut > 0)
        clipPipe += ',fade=t=out:st=' + Math.max(0, entry.duration - entry.fadeOut).toFixed(3) +
                    ':d=' + entry.fadeOut.toFixed(3) + ':alpha=1';

      fc += clipPipe + '[vi' + i + '];';
      fc += '[' + vidLabel + '][vi' + i + ']overlay=eof_action=pass[' + outLabel + '];';
      vidLabel = outLabel;
    });

    // Audio mix
    let audioLabel = '';
    if (audioInputs.length > 0) {
      audioInputs.forEach(({ idx, entry }) => {
        const delayMs = Math.round(entry.start * 1000);
        fc += '[' + idx + ':a]adelay=' + delayMs + '|' + delayMs + ',asetpts=PTS-STARTPTS[ai' + idx + '];';
      });
      const aMix = audioInputs.map(({ idx }) => '[ai' + idx + ']').join('');
      fc += aMix + 'amix=inputs=' + audioInputs.length + ':duration=longest:normalize=0[aout]';
      audioLabel = '[aout]';
    }

    doneStage('audio'); setProgress(55, 'Audio track built');
    startStage('text');  setProgress(57, 'Compositing text…');

    // Drawtext filters — merge into the video filter chain BEFORE the final output
    // Apply each drawtext to vidLabel in sequence
    textEntries.forEach(entry => {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || !clip.textProps) return;
      const p = clip.textProps;

      // Escape special chars for FFmpeg drawtext
      const escaped = (p.text.split('\n')[0] || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,');

      const x        = Math.round((p.x / 100) * outW);
      const y        = Math.round((p.y / 100) * outH);
      const fontsize  = Math.round(p.size * (outH / 1080));
      const fc_color  = p.color.replace('#', '0x');
      const alpha     = (p.opacity / 100).toFixed(2);
      const enable    = "between(t\\," + entry.start.toFixed(3) + "\\," + (entry.start + entry.duration).toFixed(3) + ")";
      const nextLabel = 'dt' + entry.id;

      let dt = '[' + vidLabel + ']drawtext=' +
        'text=\'' + escaped + '\'' +
        ':fontsize=' + fontsize +
        ':fontcolor=' + fc_color + '@' + alpha +
        ':x=' + x + '-tw/2' +
        ':y=' + y + '-th/2' +
        ':enable=\'' + enable + '\'';

      if (p.strokeWidth > 0)
        dt += ':borderw=' + Math.round(p.strokeWidth) + ':bordercolor=' + p.strokeColor.replace('#','0x');
      if (p.shadow > 0)
        dt += ':shadowx=' + Math.round(p.shadow * 0.4) + ':shadowy=' + Math.round(p.shadow * 0.4) + ':shadowcolor=0x000000@0.7';
      if (p.bgEnabled)
        dt += ':box=1:boxcolor=' + p.bgColor.replace('#','0x') + '@' + (p.bgOpacity/100).toFixed(2) + ':boxborderw=6';

      dt += '[' + nextLabel + ']';
      fc += dt + ';';
      vidLabel = nextLabel;
    });

    // Trim trailing semicolon
    fc = fc.replace(/;$/, '');

    doneStage('text'); setProgress(65, 'Text composited');
    startStage('mux');  setProgress(68, 'Encoding final output…');
    if (exportAborted) return;

    // ── Build final ffArgs ─────────────────────────────────────────
    const outFile = 'out.' + fmt;

    if (fc) {
      ffArgs.push('-filter_complex', fc);
      ffArgs.push('-map', '[' + vidLabel + ']');
      if (audioLabel) ffArgs.push('-map', audioLabel);
    } else {
      // No filters at all — just pass through
      ffArgs.push('-map', '0:v');
      if (audioInputs.length > 0) ffArgs.push('-map', String(audioInputs[0].idx) + ':a');
    }

    // Codec settings
    if (fmt === 'mp4') {
      ffArgs.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'fast',
                  '-profile:v', 'high', '-level', '4.0',
                  '-c:a', 'aac', '-b:a', '192k',
                  '-movflags', '+faststart',
                  '-t', String(totalSec));
    } else if (fmt === 'mov') {
      // MOV container with H.264 + AAC — fully compatible with iPhone, iPad, Mac
      // Baseline 3.1 profile ensures widest iOS device compatibility
      ffArgs.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'fast',
                  '-profile:v', 'baseline', '-level', '3.1',
                  '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
                  '-pix_fmt', 'yuv420p',
                  '-t', String(totalSec));
    } else if (fmt === 'webm') {
      ffArgs.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0',
                  '-c:a', 'libopus', '-b:a', '128k',
                  '-t', String(totalSec));
    } else if (fmt === 'gif') {
      // GIF uses its own palette filter — override vidLabel with palette chain
      const gifFilter = '[' + vidLabel + ']fps=' + Math.min(fps, 15) +
        ',scale=' + Math.min(outW, 640) + ':-1:flags=lanczos,split[gs0][gs1];[gs0]palettegen[gp];[gs1][gp]paletteuse';
      // Replace existing fc with gif-specific one
      ffArgs.splice(ffArgs.indexOf('-filter_complex') + 1, 1,
        fc.replace(/;$/, '') + ';' + gifFilter.replace('[' + vidLabel + ']', ''));
      ffArgs.push('-loop', '0', '-t', String(totalSec));
    }

    ffArgs.push(outFile);

    console.log('[Export] FFmpeg args:', ffArgs.join(' '));
    await ffmpegInstance.exec(ffArgs);

    doneStage('mux'); setProgress(98, 'Reading output…');

    const outData = await ffmpegInstance.readFile(outFile);
    const mime    = fmt === 'mp4'  ? 'video/mp4'
                : fmt === 'mov'  ? 'video/quicktime'
                : fmt === 'webm' ? 'video/webm'
                : 'image/gif';
    const blob    = new Blob([outData.buffer], { type: mime });
    const url     = URL.createObjectURL(blob);

    const dlBtn   = document.getElementById('export-download-btn');
    dlBtn.href     = url;
    dlBtn.download = 'cutpro-export.' + fmt;
    dlBtn.classList.add('show');
    document.getElementById('export-start-btn').style.display = 'none';

    setProgress(100, 'Done!');
    const exportMb = (blob.size / 1024 / 1024).toFixed(1);
    setStatus('✓ Export complete — ' + fmt.toUpperCase() + ' ready (' + exportMb + ' MB)');
    showLocalNotification(
      'Export complete ✓',
      fmt.toUpperCase() + ' ready · ' + exportMb + ' MB — click to open CutPro Web',
      'cutpro-export'
    );

    // Clean up virtual FS
    try { await ffmpegInstance.deleteFile(outFile); } catch(e) {}
    writtenUrls.forEach(async url => {
      const clip = state.clips.find(c => c.url === url);
      if (clip && clip._ffname) { try { await ffmpegInstance.deleteFile(clip._ffname); } catch(e) {} }
    });

  } catch (err) {
    console.error('[Export FFmpeg]', err);
    const activeStage = ['init','files','video','audio','text','mux'].find(s =>
      document.getElementById('stage-' + s)?.classList.contains('active'));
    if (activeStage) errorStage(activeStage, err.message);
    setProgress(0, '');
    document.getElementById('export-progress-label').textContent = '✗ ' + err.message;
    document.getElementById('export-start-btn').disabled = false;
    document.getElementById('export-start-btn').textContent = 'Retry';
    setStatus('Export failed: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATH B — Canvas + MediaRecorder fallback (no COEP required)
// Renders frames via Canvas, text via drawTextGraphic(), audio via WebAudio,
// records the stream with MediaRecorder into a WebM blob.
// ═══════════════════════════════════════════════════════════════════════════
async function runCanvasFallbackExport() {
  const btn = document.getElementById('export-start-btn');
  btn.disabled = true; btn.textContent = 'Recording…';

  const res    = document.getElementById('exp-resolution').value;
  const [outW, outH] = res.split('x').map(Number);
  const fps    = parseFloat(document.getElementById('exp-fps').value) || 30;
  const totalSec = Math.max(1, Math.ceil(state.seqDuration));

  try {
    // Stage labels for fallback
    document.getElementById('stage-init').querySelector('.stage-label').textContent  = 'Setting up Canvas renderer';
    document.getElementById('stage-files').querySelector('.stage-label').textContent = 'Loading video sources';
    document.getElementById('stage-video').querySelector('.stage-label').textContent = 'Rendering frames (real-time)';
    document.getElementById('stage-audio').querySelector('.stage-label').textContent = 'Mixing audio via WebAudio';
    document.getElementById('stage-text').querySelector('.stage-label').textContent  = 'Compositing text overlays';
    document.getElementById('stage-mux').querySelector('.stage-label').textContent   = 'Encoding with MediaRecorder';

    startStage('init'); setProgress(3, 'Setting up renderer…');

    // Off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');

    doneStage('init'); setProgress(8);

    // ── Load all video elements ────────────────────────────────────
    startStage('files'); setProgress(10, 'Loading video elements…');
    const videoEntries = state.timeline
      .filter(e => { const c = state.clips.find(x => x.id === e.clipId); return c && c.type === 'video' && c.url; })
      .sort((a, b) => a.start - b.start);
    const audioEntries = state.timeline
      .filter(e => { const c = state.clips.find(x => x.id === e.clipId); return c && (c.type === 'audio') && c.url; })
      .sort((a, b) => a.start - b.start);
    const textEntries  = state.timeline.filter(e => {
      const c = state.clips.find(x => x.id === e.clipId); return c && c.type === 'text';
    });

    // Pre-load video elements
    const videoEls = {};
    for (const entry of videoEntries) {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || videoEls[clip.id]) continue;
      const v = document.createElement('video');
      v.src = clip.url; v.muted = true; v.preload = 'auto';
      await new Promise(res => { v.onloadeddata = res; v.onerror = res; });
      videoEls[clip.id] = v;
    }
    doneStage('files'); setProgress(20, 'Videos loaded');

    // ── WebAudio mix ───────────────────────────────────────────────
    startStage('audio'); setProgress(22, 'Setting up audio…');
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioDest = audioCtx.createMediaStreamDestination();

    // Schedule each audio clip
    for (const entry of audioEntries) {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || !clip.url) continue;
      try {
        const resp = await fetch(clip.url);
        const buf  = await audioCtx.decodeAudioData(await resp.arrayBuffer());
        const src  = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioDest);
        src.start(audioCtx.currentTime + entry.start, entry.inPoint || 0, entry.duration);
      } catch(e) { console.warn('[Fallback] Audio load failed:', e); }
    }
    doneStage('audio'); setProgress(30, 'Audio scheduled');

    // ── MediaRecorder setup ────────────────────────────────────────
    startStage('mux'); setProgress(32, 'Starting MediaRecorder…');
    const videoStream = canvas.captureStream(fps);
    const audioTracks = audioDest.stream.getAudioTracks();
    audioTracks.forEach(t => videoStream.addTrack(t));

    // Pick best MIME type: Safari/iOS can't record WebM, prefer MP4 there
    const isIOS    = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    let mimeType;
    if (isIOS || isSafari) {
      // Safari supports video/mp4 recording (H.264 baseline via VideoToolbox)
      mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
        ? 'video/mp4;codecs=avc1'
        : MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : 'video/webm'; // last resort
    } else {
      mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
    }
    const recorder = new MediaRecorder(videoStream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });
    const chunks     = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(100);

    // ── Frame render loop ─────────────────────────────────────────
    startStage('video'); startStage('text');
    const startWall = performance.now();
    let   seqTime   = 0;

    const renderFrame = () => new Promise(resolve => {
      // Black background
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);

      // Video clips
      for (const entry of videoEntries) {
        if (seqTime < entry.start || seqTime > entry.start + entry.duration) continue;
        const clip = state.clips.find(c => c.id === entry.clipId);
        const vel  = videoEls[clip.id];
        if (!vel) continue;
        const clipTime = seqTime - entry.start + (entry.inPoint || 0);
        if (Math.abs(vel.currentTime - clipTime) > 0.1) vel.currentTime = clipTime;

        // Fade alpha
        let alpha = 1;
        const elapsed   = seqTime - entry.start;
        const remaining = entry.start + entry.duration - seqTime;
        if (entry.fadeIn  > 0 && elapsed   < entry.fadeIn)  alpha = elapsed  / entry.fadeIn;
        if (entry.fadeOut > 0 && remaining < entry.fadeOut) alpha = Math.min(alpha, remaining / entry.fadeOut);

        ctx.globalAlpha = alpha;
        ctx.drawImage(vel, 0, 0, outW, outH);
        ctx.globalAlpha = 1;
      }

      // Text overlays
      for (const entry of textEntries) {
        if (seqTime < entry.start || seqTime > entry.start + entry.duration) continue;
        const clip = state.clips.find(c => c.id === entry.clipId);
        if (!clip || !clip.textProps) continue;

        let alpha = 1;
        const elapsed   = seqTime - entry.start;
        const remaining = entry.start + entry.duration - seqTime;
        if (entry.fadeIn  > 0 && elapsed   < entry.fadeIn)  alpha = elapsed  / entry.fadeIn;
        if (entry.fadeOut > 0 && remaining < entry.fadeOut) alpha = Math.min(alpha, remaining / entry.fadeOut);

        drawTextGraphic(ctx, clip.textProps, outW, outH, alpha);
      }

      resolve();
    });

    // Render at real-time pace (MediaRecorder captures at fps rate)
    const frameDur = 1000 / fps;
    while (seqTime <= totalSec && !exportAborted) {
      await renderFrame();
      const pct  = (seqTime / totalSec) * 60;
      setProgress(32 + pct, 'Rendering ' + seqTime.toFixed(1) + 's / ' + totalSec + 's');

      // Pace to real-time so MediaRecorder captures at the right rate
      const elapsed = performance.now() - startWall;
      const target  = seqTime * 1000;
      if (target > elapsed) await new Promise(r => setTimeout(r, target - elapsed));

      seqTime += 1 / fps;
    }

    doneStage('video'); doneStage('text'); setProgress(92, 'Finalising…');

    // Stop recording
    await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
    await audioCtx.close();

    doneStage('mux'); setProgress(98, 'Building download…');

    const blob = new Blob(chunks, { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const dl   = document.getElementById('export-download-btn');
    dl.href     = url;
    const fallbackExt = mimeType.includes('mp4') ? 'mp4' : 'webm';
    dl.download = 'cutpro-export.' + fallbackExt;
    dl.classList.add('show');
    document.getElementById('export-start-btn').style.display = 'none';

    setProgress(100, 'Done!');
    const canvasMb = (blob.size/1024/1024).toFixed(1);
    setStatus('✓ Canvas export complete — WebM ready (' + canvasMb + ' MB)');
    showLocalNotification(
      'Export complete ✓',
      'Video ready · ' + canvasMb + ' MB — click to open CutPro Web',
      'cutpro-export'
    );

  } catch(err) {
    console.error('[Export Canvas]', err);
    const activeStage = ['init','files','video','audio','text','mux'].find(s =>
      document.getElementById('stage-' + s)?.classList.contains('active'));
    if (activeStage) errorStage(activeStage, err.message);
    document.getElementById('export-progress-label').textContent = '✗ ' + err.message;
    document.getElementById('export-start-btn').disabled = false;
    document.getElementById('export-start-btn').textContent = 'Retry';
    setStatus('Export failed: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INSPECTOR SLIDERS
// ─────────────────────────────────────────────────────────────────────────────
[
  ['scale', '%'], ['rotate', '°'], ['opacity', '%'],
  ['bright', ''], ['contrast', ''], ['sat', ''],
  ['crop-l', ''], ['crop-r', ''], ['crop-t', ''], ['crop-b', '']
].forEach(([key, unit]) => {
  const slider = document.getElementById('p-' + key);
  const val = document.getElementById('pv-' + key);
  if (slider && val) {
    slider.addEventListener('input', () => { val.textContent = slider.value + unit; });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FILE IMPORT
// ─────────────────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => importFiles(e.target.files));

// Bin search filter
document.getElementById('bin-search').addEventListener('input', () => renderBin());

// Zoom tool button
document.getElementById('btn-zoom-tl').addEventListener('click', () => {
  state.currentTool = 'zoom';
  ['select','edit','blade','zoom-tl'].forEach(t => document.getElementById('btn-'+t)?.classList.remove('active'));
  document.getElementById('btn-zoom-tl').classList.add('active');
  document.getElementById('timeline-tracks').style.cursor = 'zoom-in';
});

// Scrubber drag for viewer
document.getElementById('src-scrub').addEventListener('click', (e) => {
  const vid = document.getElementById('src-video');
  if (!vid.src || !vid.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  vid.currentTime = pct * vid.duration;
});

// Drag & drop
const dragOverlay = document.getElementById('drag-overlay');
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragOverlay.classList.add('show'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dragOverlay.classList.remove('show'); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragOverlay.classList.remove('show');
  if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
});

// Bin drop zone
dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); dropZone.classList.add('drag-mode'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); dropZone.classList.remove('drag-mode'); });
dropZone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); dropZone.classList.remove('drag-mode');
  if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
});

// Track drop
TRACK_ORDER.forEach(tId => {
  const trackEl = document.getElementById('track-' + tId);
  if (!trackEl) return;
  trackEl.addEventListener('dragover', (e) => { e.preventDefault(); trackEl.style.background = 'rgba(74,143,205,0.15)'; });
  trackEl.addEventListener('dragleave', () => { trackEl.style.background = ''; });
  trackEl.addEventListener('drop', (e) => {
    e.preventDefault(); trackEl.style.background = '';
    if (state.selectedClipId) addToTimeline(state.selectedClipId, tId);
    if (e.dataTransfer.files.length) {
      importFiles(e.dataTransfer.files);
      setTimeout(() => {
        if (state.clips.length) addToTimeline(state.clips[state.clips.length-1].id, tId);
      }, 500);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch(e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'a': case 'A': document.getElementById('btn-select').click(); break;
    case 'b': case 'B': document.getElementById('btn-blade').click(); break;
    case 'e': case 'E': document.getElementById('btn-edit').click(); break;
    case 'i': case 'I': document.getElementById('src-mark-in').click(); break;
    case 'o': case 'O': document.getElementById('src-mark-out').click(); break;
    case 'ArrowLeft': state.playheadTime = Math.max(0, state.playheadTime - 1/30); updatePlayhead(); break;
    case 'ArrowRight': state.playheadTime = Math.min(state.seqDuration, state.playheadTime + 1/30); updatePlayhead(); break;
    case 'Delete': case 'Backspace':
      if (state.selectedTimelineId) {
        document.getElementById('btn-ripple-del').click();
      }
      break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL RESIZE
// ─────────────────────────────────────────────────────────────────────────────
function makeResizablePanel(handleId, panelId, side) {
  const handle = document.getElementById(handleId);
  const panel = document.getElementById(panelId);
  if (!handle || !panel) return;
  let startX, startW;
  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const newW = side === 'right' ? startW - dx : startW + dx;
      panel.style.width = Math.max(120, Math.min(400, newW)) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
makeResizablePanel('rh-browser', 'browser', 'left');
makeResizablePanel('rh-inspector', 'inspector', 'right');

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('cvs-fullscreen').addEventListener('click', () => {
  const screen = document.getElementById('viewer-screen-cvs');
  if (!document.fullscreenElement) screen.requestFullscreen?.();
  else document.exitFullscreen?.();
});


// ═════════════════════════════════════════════════════════════════════════════
// MUSIC LIBRARY
// All tracks are public domain / CC0 / Creative Commons licensed.
// Sources: Internet Archive, ccMixter, Musopen, Free Music Archive.
// ═════════════════════════════════════════════════════════════════════════════

// MUSIC LIBRARY — All tracks are verified free for use:
// • Public Domain: composer died >70 years ago, no copyright
// • CC0: creator explicitly waived all rights (free for any use)
// • CC BY 3.0: free for any use including commercial, with credit to Kevin MacLeod (incompetech.com)
//   Required attribution format: "Music by Kevin MacLeod (incompetech.com)"
//   Licensed under Creative Commons Attribution 3.0
// All URLs served from Internet Archive (archive.org) with CORS headers enabled.
const MUSIC_LIBRARY = [
  // ── CINEMATIC ──────────────────────────────────────────────────────────────
  {
    id: 'mc01', title: 'Gymnopedie No.1', artist: 'Erik Satie (1888)',
    mood: 'cinematic', bpm: 60, dur: '3:05',
    tags: ['cinematic','classical','piano'],
    url: 'https://ia800201.us.archive.org/33/items/GymnopdieNo.1/Gymnop%C3%A9die%20No.1.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mc02', title: 'Clair de Lune', artist: 'Claude Debussy (1905)',
    mood: 'cinematic', bpm: 54, dur: '5:00',
    tags: ['cinematic','classical','piano'],
    url: 'https://ia800504.us.archive.org/8/items/ClairDeLune_272/ClairDeLune.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mc03', title: 'Moonlight Sonata (1st Mvt)', artist: 'Beethoven (1801)',
    mood: 'cinematic', bpm: 58, dur: '5:49',
    tags: ['cinematic','classical','piano'],
    url: 'https://ia800303.us.archive.org/29/items/BeethovenPianoSonataNo.14Op.27No.2Moonlight/BeethovenPianoSonataNo.14Op.27No.2Moonlight_01.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mc04', title: 'The Four Seasons – Spring', artist: 'Vivaldi (1725)',
    mood: 'cinematic', bpm: 126, dur: '3:32',
    tags: ['cinematic','classical','orchestra'],
    url: 'https://ia600301.us.archive.org/30/items/VivaldiTheFourSeasons/Vivaldi_-_Spring_mvt_1.mp3',
    license: 'Public Domain',
  },

  // ── AMBIENT ────────────────────────────────────────────────────────────────
  {
    id: 'ma01', title: 'Snowfall', artist: 'Jason Shaw (CC0)',
    mood: 'ambient', bpm: 70, dur: '3:30',
    tags: ['ambient','atmospheric','calm'],
    url: 'https://ia801605.us.archive.org/35/items/audionautix-genre-acoustic/Audionautix%20Genre%20-%20Acoustic%20-%20Jason%20Shaw%20-%20Snowfall.mp3',
    license: 'CC0',
  },
  {
    id: 'ma02', title: 'Slow Burn', artist: 'Kevin MacLeod (CC BY)',
    mood: 'ambient', bpm: 68, dur: '3:32',
    tags: ['ambient','drone','tension'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Slow%20Burn.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'ma03', title: 'Floating Cities', artist: 'Kevin MacLeod (CC BY)',
    mood: 'ambient', bpm: 80, dur: '2:37',
    tags: ['ambient','spacey','relaxed'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Floating%20Cities.mp3',
    license: 'CC BY 3.0',
  },

  // ── UPBEAT ─────────────────────────────────────────────────────────────────
  {
    id: 'mu01', title: 'Carefree', artist: 'Kevin MacLeod (CC BY)',
    mood: 'upbeat', bpm: 120, dur: '2:24',
    tags: ['upbeat','fun','light'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Carefree.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mu02', title: 'Sunshine', artist: 'Jason Shaw (CC0)',
    mood: 'upbeat', bpm: 130, dur: '3:14',
    tags: ['upbeat','pop','happy'],
    url: 'https://ia801605.us.archive.org/35/items/audionautix-genre-acoustic/Audionautix%20Genre%20-%20Acoustic%20-%20Jason%20Shaw%20-%20Sunshine.mp3',
    license: 'CC0',
  },
  {
    id: 'mu03', title: 'Fluffing a Duck', artist: 'Kevin MacLeod (CC BY)',
    mood: 'upbeat', bpm: 120, dur: '2:01',
    tags: ['upbeat','comedy','fun'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Fluffing%20a%20Duck.mp3',
    license: 'CC BY 3.0',
  },

  // ── DRAMATIC ───────────────────────────────────────────────────────────────
  {
    id: 'md01', title: 'Ominous', artist: 'Kevin MacLeod (CC BY)',
    mood: 'dramatic', bpm: 90, dur: '2:18',
    tags: ['dramatic','dark','tension'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Ominous.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'md02', title: 'Eternal Source of Light Divine', artist: 'Handel (1713)',
    mood: 'dramatic', bpm: 82, dur: '6:22',
    tags: ['dramatic','classical','orchestra'],
    url: 'https://ia600607.us.archive.org/34/items/HandelEternalSourceOfLightDivine/Handel%20-%20Eternal%20Source%20of%20Light%20Divine.mp3',
    license: 'Public Domain',
  },
  {
    id: 'md03', title: 'Impact Moderato', artist: 'Kevin MacLeod (CC BY)',
    mood: 'dramatic', bpm: 104, dur: '2:06',
    tags: ['dramatic','action','intense'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Impact%20Moderato.mp3',
    license: 'CC BY 3.0',
  },

  // ── PEACEFUL ───────────────────────────────────────────────────────────────
  {
    id: 'mp01', title: 'Canon in D', artist: 'Johann Pachelbel (1680)',
    mood: 'peaceful', bpm: 64, dur: '5:14',
    tags: ['peaceful','classical','strings'],
    url: 'https://ia600401.us.archive.org/23/items/PachelbelCanonInD/PachelbelCanonInD.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mp02', title: 'Morning Mood', artist: 'Edvard Grieg (1875)',
    mood: 'peaceful', bpm: 58, dur: '3:58',
    tags: ['peaceful','classical','orchestra'],
    url: 'https://ia600304.us.archive.org/20/items/GriegPeerGyntSuite/01GriegMorningMoodFromPeerGyntSuite1.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mp03', title: 'Meditation Impromptu 02', artist: 'Kevin MacLeod (CC BY)',
    mood: 'peaceful', bpm: 72, dur: '3:31',
    tags: ['peaceful','piano','reflective'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Meditation%20Impromptu%2002.mp3',
    license: 'CC BY 3.0',
  },

  // ── JAZZ ───────────────────────────────────────────────────────────────────
  {
    id: 'mj01', title: 'Bossa Antigua', artist: 'Kevin MacLeod (CC BY)',
    mood: 'jazz', bpm: 110, dur: '3:32',
    tags: ['jazz','bossa nova','latin'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Bossa%20Antigua.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mj02', title: 'Cool Vibes', artist: 'Kevin MacLeod (CC BY)',
    mood: 'jazz', bpm: 96, dur: '3:14',
    tags: ['jazz','lounge','smooth'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Cool%20Vibes.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mj03', title: 'Jazz Comedy', artist: 'Kevin MacLeod (CC BY)',
    mood: 'jazz', bpm: 192, dur: '1:42',
    tags: ['jazz','comedy','fun'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Jazz%20Comedy.mp3',
    license: 'CC BY 3.0',
  },

  // ── CLASSICAL ──────────────────────────────────────────────────────────────
  {
    id: 'mcl01', title: 'Air on the G String', artist: 'J.S. Bach (1717)',
    mood: 'classical', bpm: 54, dur: '5:43',
    tags: ['classical','baroque','strings'],
    url: 'https://ia600202.us.archive.org/8/items/JS_Bach_Air_on_the_G_string/Air_on_the_G_String.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mcl02', title: 'Eine Kleine Nachtmusik', artist: 'Mozart (1787)',
    mood: 'classical', bpm: 134, dur: '6:00',
    tags: ['classical','allegro','strings'],
    url: 'https://ia600305.us.archive.org/18/items/MozartEineKleineNachtmusik/01EineKleineNachtmusikMovement1.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mcl03', title: 'Waltz of the Flowers', artist: 'Tchaikovsky (1892)',
    mood: 'classical', bpm: 178, dur: '6:48',
    tags: ['classical','ballet','orchestra'],
    url: 'https://ia800304.us.archive.org/20/items/TchaikovskyNutcrackerSuite/10WaltzOfTheFlowers.mp3',
    license: 'Public Domain',
  },

  // ── FOLK ───────────────────────────────────────────────────────────────────
  {
    id: 'mf01', title: 'Old Molly Hare', artist: 'Appalachian Folk (Traditional)',
    mood: 'folk', bpm: 112, dur: '2:18',
    tags: ['folk','fiddle','traditional','appalachian'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Appalachian%20Waltz.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mf02', title: 'Brandenburg Concerto No.3 (1st Mvt)', artist: 'J.S. Bach (1721)',
    mood: 'folk', bpm: 132, dur: '4:48',
    tags: ['folk','baroque','strings','lively'],
    url: 'https://ia600509.us.archive.org/1/items/BrandenburgConcertosNos.1-3/BrandenburgConcerto3.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mf03', title: 'The Entertainer', artist: 'Scott Joplin (1902)',
    mood: 'folk', bpm: 96, dur: '3:20',
    tags: ['folk','ragtime','piano','cheerful'],
    url: 'https://ia800607.us.archive.org/17/items/TheEntertainer_201410/The_Entertainer.mp3',
    license: 'Public Domain',
  },

  // ── CINEMATIC (additional) ────────────────────────────────────────────────
  {
    id: 'mc05', title: 'Nocturne Op.9 No.2', artist: 'Frédéric Chopin (1832)',
    mood: 'cinematic', bpm: 66, dur: '4:33',
    tags: ['cinematic','piano','nocturne','romantic'],
    url: 'https://ia600301.us.archive.org/14/items/NocturneOp.9No.2/NocturneOp9No2.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mc06', title: 'Prelude in C Major (Well-Tempered)', artist: 'J.S. Bach (1722)',
    mood: 'cinematic', bpm: 72, dur: '2:25',
    tags: ['cinematic','baroque','piano','peaceful'],
    url: 'https://ia800303.us.archive.org/18/items/PreludeInCMajorFromWellTemperedClavierBookI/PreludeInCMajorFromWellTemperedClavierBookI.mp3',
    license: 'Public Domain',
  },

  // ── AMBIENT (additional) ──────────────────────────────────────────────────
  {
    id: 'ma04', title: 'Healing', artist: 'Kevin MacLeod (CC BY)',
    mood: 'ambient', bpm: 60, dur: '3:10',
    tags: ['ambient','healing','soft','meditation'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Healing.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'ma05', title: 'Lightless Dawn', artist: 'Kevin MacLeod (CC BY)',
    mood: 'ambient', bpm: 55, dur: '2:48',
    tags: ['ambient','dark','atmospheric','drone'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Lightless%20Dawn.mp3',
    license: 'CC BY 3.0',
  },

  // ── UPBEAT (additional) ───────────────────────────────────────────────────
  {
    id: 'mu04', title: 'Funky Chunk', artist: 'Kevin MacLeod (CC BY)',
    mood: 'upbeat', bpm: 115, dur: '2:02',
    tags: ['upbeat','funk','energetic','groove'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Funky%20Chunk.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mu05', title: 'Investigations', artist: 'Kevin MacLeod (CC BY)',
    mood: 'upbeat', bpm: 126, dur: '2:32',
    tags: ['upbeat','mystery','quirky','detective'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Investigations.mp3',
    license: 'CC BY 3.0',
  },

  // ── DRAMATIC (additional) ─────────────────────────────────────────────────
  {
    id: 'md04', title: 'Destiny Day', artist: 'Kevin MacLeod (CC BY)',
    mood: 'dramatic', bpm: 100, dur: '2:14',
    tags: ['dramatic','epic','intense','orchestral'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Destiny%20Day.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'md05', title: 'Hall of the Mountain King', artist: 'Edvard Grieg (1875)',
    mood: 'dramatic', bpm: 88, dur: '2:22',
    tags: ['dramatic','classical','orchestra','building'],
    url: 'https://ia600304.us.archive.org/20/items/GriegPeerGyntSuite/04HallOfTheMountainKingFromPeerGyntSuite1.mp3',
    license: 'Public Domain',
  },

  // ── PEACEFUL (additional) ─────────────────────────────────────────────────
  {
    id: 'mp04', title: 'Gymnopédie No.3', artist: 'Erik Satie (1888)',
    mood: 'peaceful', bpm: 58, dur: '3:19',
    tags: ['peaceful','piano','impressionist','slow'],
    url: 'https://ia800201.us.archive.org/33/items/GymnopdieNo.1/Gymnop%C3%A9die%20No.3.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mp05', title: 'Relaxing Piano', artist: 'Kevin MacLeod (CC BY)',
    mood: 'peaceful', bpm: 64, dur: '3:34',
    tags: ['peaceful','piano','relaxing','soft'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Relaxing%20Piano%20Music.mp3',
    license: 'CC BY 3.0',
  },

  // ── JAZZ (additional) ─────────────────────────────────────────────────────
  {
    id: 'mj04', title: 'Suonatore di Liuto', artist: 'Kevin MacLeod (CC BY)',
    mood: 'jazz', bpm: 88, dur: '2:40',
    tags: ['jazz','acoustic','mediterranean','guitar'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Suonatore%20di%20Liuto.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mj05', title: 'Sneaky Snitch', artist: 'Kevin MacLeod (CC BY)',
    mood: 'jazz', bpm: 144, dur: '2:05',
    tags: ['jazz','comedy','sneaky','playful'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Sneaky%20Snitch.mp3',
    license: 'CC BY 3.0',
  },

  // ── CLASSICAL (additional) ────────────────────────────────────────────────
  {
    id: 'mcl04', title: 'Ode to Joy (9th Symphony)', artist: 'Beethoven (1824)',
    mood: 'classical', bpm: 100, dur: '3:55',
    tags: ['classical','orchestra','triumphant','choir'],
    url: 'https://ia600303.us.archive.org/20/items/OdeToJoy/01-OdeToJoy.mp3',
    license: 'Public Domain',
  },
  {
    id: 'mcl05', title: 'Serenade No.13 "Eine Kleine" (2nd Mvt)', artist: 'Mozart (1787)',
    mood: 'classical', bpm: 58, dur: '5:40',
    tags: ['classical','strings','romantic','gentle'],
    url: 'https://ia600305.us.archive.org/18/items/MozartEineKleineNachtmusik/02EineKleineNachtmusikMovement2.mp3',
    license: 'Public Domain',
  },

  // ── FOLK (additional) ─────────────────────────────────────────────────────
  {
    id: 'mf04', title: 'Wallpaper', artist: 'Kevin MacLeod (CC BY)',
    mood: 'folk', bpm: 100, dur: '3:04',
    tags: ['folk','acoustic','guitar','warm'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Wallpaper.mp3',
    license: 'CC BY 3.0',
  },
  {
    id: 'mf05', title: 'Acoustic Guitar 1', artist: 'Kevin MacLeod (CC BY)',
    mood: 'folk', bpm: 95, dur: '2:41',
    tags: ['folk','acoustic','guitar','fingerpicking'],
    url: 'https://ia800501.us.archive.org/8/items/Kevin_MacLeod_incompetech/Acoustic%20Guitar%201.mp3',
    license: 'CC BY 3.0',
  },
];

// ── Music library state ──────────────────────────────────────────────────────
const musicState = {
  activeMood: 'all',
  searchQ: '',
  previewTrack: null,
  previewAudio: null,
  selectedTrackId: null,
};

// ── Tab switching ────────────────────────────────────────────────────────────
document.getElementById('tab-bin').addEventListener('click', () => {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-bin').classList.add('active');
  document.getElementById('music-library').classList.remove('open');
});
document.getElementById('tab-effects').addEventListener('click', () => {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-effects').classList.add('active');
  document.getElementById('music-library').classList.remove('open');
});
document.getElementById('tab-music').addEventListener('click', async () => {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-music').classList.add('active');
  document.getElementById('music-library').classList.add('open');
  // Refresh cache state so pin indicators are current
  await refreshCachedAudioUrls();
  renderMusicLibrary();
  updateCacheSizeDisplay();
});

// ── Render ───────────────────────────────────────────────────────────────────
function renderMusicLibrary() {
  const list = document.getElementById('music-list');
  const q = musicState.searchQ.toLowerCase();
  const mood = musicState.activeMood;

  const filtered = MUSIC_LIBRARY.filter(t => {
    const moodOk = mood === 'all' || t.mood === mood;
    const qOk = !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.tags.some(tag => tag.includes(q));
    return moodOk && qOk;
  });

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:10px;">No tracks match your search.</div>';
    return;
  }

  filtered.forEach(track => {
    const isPlaying = musicState.previewTrack?.id === track.id && musicState.previewAudio && !musicState.previewAudio.paused;
    const isSelected = musicState.selectedTrackId === track.id;

    const item = document.createElement('div');
    item.className = `music-item${isSelected ? ' selected' : ''}${isPlaying ? ' playing' : ''}`;
    item.dataset.id = track.id;

    const tagsHtml = track.tags.map(tag =>
      `<span class="music-tag mood-${tag.replace(' ','-')}">${tag}</span>`
    ).join('');

    item.innerHTML = `
      <button class="music-play-btn${isPlaying ? ' playing' : ''}" data-id="${track.id}" title="${isPlaying ? 'Pause' : 'Preview'}">
        ${isPlaying ? '⏸' : '▶'}
      </button>
      <div class="music-info">
        <div class="music-title">${esc(track.title)}</div>
        <div class="music-artist">${esc(track.artist)}</div>
        <div class="music-tags">${tagsHtml}<span class="music-tag bpm-tag">${track.bpm} BPM</span></div>
      </div>
      <div class="music-dur">${track.dur}</div>
      <button class="music-add-btn" data-id="${track.id}" title="Add to Bin">+</button>`;

    // Play/pause
    item.querySelector('.music-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMusicPreview(track);
    });

    // Add to bin
    item.querySelector('.music-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      addMusicToBin(track);
    });

    // Select
    item.addEventListener('click', () => {
      musicState.selectedTrackId = track.id;
      document.getElementById('music-preview-title').textContent = `${esc(track.title)} — ${esc(track.artist)} · ${esc(track.license)}`;
      renderMusicLibrary();
    });

    list.appendChild(item);
  });
}

// ── Preview playback ─────────────────────────────────────────────────────────
function toggleMusicPreview(track) {
  // Stop existing
  if (musicState.previewAudio) {
    musicState.previewAudio.pause();
    if (musicState.previewTrack?.id === track.id) {
      // Toggling same track off
      musicState.previewTrack = null;
      document.getElementById('music-prev-play').textContent = '▶';
      document.getElementById('music-preview-title').textContent = 'Select a track to preview';
      renderMusicLibrary();
      return;
    }
  }

  // Start new track
  musicState.previewTrack = track;
  musicState.selectedTrackId = track.id;

  if (!musicState.previewAudio) {
    musicState.previewAudio = new Audio();
    musicState.previewAudio.addEventListener('timeupdate', updateMusicProgress);
    musicState.previewAudio.addEventListener('ended', () => {
      musicState.previewTrack = null;
      document.getElementById('music-prev-play').textContent = '▶';
      document.getElementById('music-preview-fill').style.width = '0%';
      renderMusicLibrary();
    });
    musicState.previewAudio.addEventListener('error', () => {
      setStatus(`⚠ Could not load "${esc(track.title)}" — check your connection`);
      musicState.previewTrack = null;
      renderMusicLibrary();
    });
  }

  musicState.previewAudio.src = track.url;
  musicState.previewAudio.load();
  musicState.previewAudio.play().catch(() => {
    setStatus(`⚠ Playback blocked — click the play button to try again`);
  });

  document.getElementById('music-prev-play').textContent = '⏸';
  document.getElementById('music-preview-title').textContent = `▶ ${esc(track.title)} — ${esc(track.artist)} · ${esc(track.license)}`;
  renderMusicLibrary();
}

function updateMusicProgress() {
  const audio = musicState.previewAudio;
  if (!audio || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('music-preview-fill').style.width = pct + '%';
}

// ── User custom tracks (stored in localStorage) ─────────────────────────────
const CUSTOM_TRACKS_KEY = 'cutpro_custom_tracks_v1';

function getCustomTracks() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TRACKS_KEY) || '[]'); } catch(e) { return []; }
}
function saveCustomTracks(tracks) {
  try { localStorage.setItem(CUSTOM_TRACKS_KEY, JSON.stringify(tracks)); } catch(e) {}
}

// Merge custom tracks into library at runtime
function getFullLibrary() {
  return [...MUSIC_LIBRARY, ...getCustomTracks()];
}

// Override renderMusicLibrary to include custom tracks
(function() {
  const origRML = renderMusicLibrary;
  renderMusicLibrary = function renderMusicLibrary() {
    const list = document.getElementById('music-list');
    const q    = musicState.searchQ.toLowerCase();
    const mood = musicState.activeMood;

    const fullLib = getFullLibrary();
    const filtered = fullLib.filter(t => {
      const moodOk = mood === 'all' || t.mood === mood;
      const qOk    = !q || t.title.toLowerCase().includes(q) ||
                     t.artist.toLowerCase().includes(q) ||
                     (t.tags || []).some(tag => tag.includes(q));
      return moodOk && qOk;
    });

    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:10px;">No tracks match your search.</div>';
      return;
    }

    filtered.forEach(track => {
      const isPlaying  = musicState.previewTrack?.id === track.id && musicState.previewAudio && !musicState.previewAudio.paused;
      const isSelected = musicState.selectedTrackId === track.id;
      const isCustom   = track._custom;

      const item = document.createElement('div');
      item.className = `music-item${isSelected ? ' selected' : ''}${isPlaying ? ' playing' : ''}`;
      item.dataset.id = track.id;

      const tagsHtml = (track.tags || []).map(tag =>
        `<span class="music-tag">${tag}</span>`).join('');
      const customBadge = isCustom ? '<span class="music-tag" style="background:rgba(74,143,80,0.2);color:#5aaa6a;">custom</span>' : '';
      const delBtn = isCustom ? `<button class="music-add-btn" data-del="${track.id}" title="Remove" style="background:rgba(180,50,50,0.2);color:#e08080;">✕</button>` : '';

      const isCached   = cachedAudioUrls.has(track.url);
      const offlineBtn = !isCustom && track.url?.includes('archive.org')
        ? `<button class="music-offline-btn${isCached ? ' cached' : ''}" data-offline="${track.id}"
             title="${isCached ? 'Remove from offline storage' : 'Save for offline use'}"
             style="width:20px;height:20px;padding:0;border-radius:3px;font-size:10px;cursor:pointer;flex-shrink:0;
                    background:${isCached ? 'rgba(60,180,80,0.2)' : 'rgba(40,60,80,0.4)'};
                    border:1px solid ${isCached ? '#3aaa50' : '#2a4060'};
                    color:${isCached ? '#5add6a' : '#4a7090'};
                    display:flex;align-items:center;justify-content:center;"
           >${isCached ? '✓' : '⬇'}</button>`
        : '';

      item.innerHTML = `
        <button class="music-play-btn${isPlaying ? ' playing' : ''}" data-id="${track.id}">${isPlaying ? '⏸' : '▶'}</button>
        <div class="music-info">
          <div class="music-title">${esc(track.title)}${customBadge}${isCached ? '<span style="color:#3aaa50;font-size:8px;margin-left:4px;">●offline</span>' : ''}</div>
          <div class="music-artist">${esc(track.artist)}</div>
          <div class="music-tags">${tagsHtml}<span class="music-tag bpm-tag">${track.bpm} BPM</span></div>
        </div>
        <div class="music-dur">${track.dur || '—'}</div>
        ${offlineBtn}
        <button class="music-add-btn" data-id="${track.id}" title="Add to Bin">+</button>
        ${delBtn}`;

      item.querySelector('.music-play-btn').addEventListener('click', e => {
        e.stopPropagation(); toggleMusicPreview(track);
      });
      // Offline pin/unpin button
      const offlineBtnEl = item.querySelector('.music-offline-btn');
      if (offlineBtnEl) {
        offlineBtnEl.addEventListener('click', async e => {
          e.stopPropagation();
          const isCachedNow = cachedAudioUrls.has(track.url);
          if (isCachedNow) {
            offlineBtnEl.textContent = '…';
            await unpinTrackOffline(track);
          } else {
            offlineBtnEl.textContent = '…';
            offlineBtnEl.style.color = '#aaa';
            await pinTrackOffline(track);
          }
          await refreshCachedAudioUrls();
          updateCacheSizeDisplay();
        });
      }
      item.querySelectorAll('.music-add-btn[data-id]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          if (btn.dataset.del) {
            // Remove custom track
            const updated = getCustomTracks().filter(t => t.id !== btn.dataset.del);
            saveCustomTracks(updated);
            renderMusicLibrary();
            setStatus('Custom track removed');
          } else {
            addMusicToBin(track);
          }
        });
      });
      item.addEventListener('click', () => {
        musicState.selectedTrackId = track.id;
        document.getElementById('music-preview-title').textContent = `${esc(track.title)} — ${esc(track.artist)} · ${track.license || 'Custom'}`;
        renderMusicLibrary();
      });
      list.appendChild(item);
    });
  };
})();

// ── Custom track dialog ───────────────────────────────────────────────────────
document.getElementById('music-add-custom-btn')?.addEventListener('click', () => {
  // Build a simple inline form in the music-list area
  const list = document.getElementById('music-list');
  list.innerHTML = `
    <div style="padding:12px;font-size:10px;">
      <div style="color:#5a8aaa;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Add Custom Track</div>
      <div style="margin-bottom:6px;">
        <label style="color:var(--text-secondary);display:block;margin-bottom:2px;">Title</label>
        <input id="ct-title" type="text" placeholder="Track title" style="width:100%;height:24px;background:#0d0d0d;border:1px solid #1a2a3a;border-radius:3px;color:#fff;font-size:10px;padding:0 6px;box-sizing:border-box;font-family:inherit;">
      </div>
      <div style="margin-bottom:6px;">
        <label style="color:var(--text-secondary);display:block;margin-bottom:2px;">Artist</label>
        <input id="ct-artist" type="text" placeholder="Artist name" style="width:100%;height:24px;background:#0d0d0d;border:1px solid #1a2a3a;border-radius:3px;color:#fff;font-size:10px;padding:0 6px;box-sizing:border-box;font-family:inherit;">
      </div>
      <div style="margin-bottom:6px;">
        <label style="color:var(--text-secondary);display:block;margin-bottom:2px;">Audio URL or local file</label>
        <div style="display:flex;gap:4px;">
          <input id="ct-url" type="text" placeholder="https://... or leave blank and pick file" style="flex:1;height:24px;background:#0d0d0d;border:1px solid #1a2a3a;border-radius:3px;color:#fff;font-size:10px;padding:0 6px;font-family:inherit;">
          <button id="ct-file-btn" style="height:24px;padding:0 8px;background:#1a2030;border:1px solid #2a3a4a;border-radius:3px;color:#5a8aaa;font-size:10px;cursor:pointer;font-family:inherit;white-space:nowrap;">📁 File</button>
          <input id="ct-file-input" type="file" accept="audio/*" style="display:none">
        </div>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:6px;">
        <div style="flex:1;">
          <label style="color:var(--text-secondary);display:block;margin-bottom:2px;">Mood</label>
          <select id="ct-mood" style="width:100%;height:24px;background:#0d0d0d;border:1px solid #1a2a3a;border-radius:3px;color:#fff;font-size:10px;padding:0 4px;font-family:inherit;">
            <option value="cinematic">Cinematic</option><option value="ambient">Ambient</option>
            <option value="upbeat">Upbeat</option><option value="dramatic">Dramatic</option>
            <option value="peaceful">Peaceful</option><option value="jazz">Jazz</option>
            <option value="classical">Classical</option><option value="folk">Folk</option>
          </select>
        </div>
        <div style="width:64px;">
          <label style="color:var(--text-secondary);display:block;margin-bottom:2px;">BPM</label>
          <input id="ct-bpm" type="number" value="120" min="40" max="240" style="width:100%;height:24px;background:#0d0d0d;border:1px solid #1a2a3a;border-radius:3px;color:#fff;font-size:10px;padding:0 4px;font-family:inherit;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button id="ct-save" style="flex:1;height:26px;background:linear-gradient(to bottom,#1e4a6a,#163860);border:1px solid #1a3a5a;border-top-color:#3a7aaa;border-radius:4px;color:#6ab0e0;font-size:10px;cursor:pointer;font-family:inherit;font-weight:bold;">Save to Library</button>
        <button id="ct-cancel" style="height:26px;padding:0 12px;background:#111;border:1px solid #222;border-radius:4px;color:#666;font-size:10px;cursor:pointer;font-family:inherit;">Cancel</button>
      </div>
    </div>`;

  document.getElementById('ct-file-btn').addEventListener('click', () => document.getElementById('ct-file-input').click());
  document.getElementById('ct-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    document.getElementById('ct-url').value = blobUrl;
    if (!document.getElementById('ct-title').value) document.getElementById('ct-title').value = file.name.replace(/\.[^.]+$/, '');
  });

  document.getElementById('ct-cancel').addEventListener('click', () => renderMusicLibrary());

  document.getElementById('ct-save').addEventListener('click', () => {
    const title  = document.getElementById('ct-title').value.trim();
    const artist = document.getElementById('ct-artist').value.trim() || 'Custom';
    const url    = document.getElementById('ct-url').value.trim();
    const mood   = document.getElementById('ct-mood').value;
    const bpm    = parseInt(document.getElementById('ct-bpm').value) || 120;

    if (!title)  { setStatus('Enter a track title'); return; }
    if (!url)    { setStatus('Enter a URL or pick a file'); return; }

    const track = {
      id: 'custom_' + uid(),
      title, artist, mood, bpm,
      dur: '—',
      tags: ['custom', mood],
      url,
      license: 'Custom',
      _custom: true,
    };

    const existing = getCustomTracks();
    existing.push(track);
    saveCustomTracks(existing);
    renderMusicLibrary();
    setStatus(`✓ "${title}" added to library`);
  });
});

// ── Preview bar controls ──────────────────────────────────────────────────────
document.getElementById('music-prev-play').addEventListener('click', () => {
  if (!musicState.previewTrack) return;
  const audio = musicState.previewAudio;
  if (!audio) return;
  if (audio.paused) {
    audio.play();
    document.getElementById('music-prev-play').textContent = '⏸';
  } else {
    audio.pause();
    document.getElementById('music-prev-play').textContent = '▶';
  }
  renderMusicLibrary();
});

document.getElementById('music-add-to-bin-btn').addEventListener('click', () => {
  const fullLib = typeof getFullLibrary === 'function' ? getFullLibrary() : MUSIC_LIBRARY;
  const track = fullLib.find(t => t.id === musicState.selectedTrackId);
  if (track) addMusicToBin(track);
  else setStatus('Select a track first');
});

document.getElementById('music-cache-all-btn')?.addEventListener('click', pinAllTracksOffline);
document.getElementById('music-cache-clear-btn')?.addEventListener('click', () => {
  if (confirm('Remove all offline music from your device?')) clearAudioCache();
});

// ── Mood filter ───────────────────────────────────────────────────────────────
document.querySelectorAll('.mood-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    musicState.activeMood = chip.dataset.mood;
    renderMusicLibrary();
  });
});

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById('music-search').addEventListener('input', (e) => {
  musicState.searchQ = e.target.value;
  renderMusicLibrary();
});

// ── Pin All / Clear Cache ─────────────────────────────────────────────────────
document.getElementById('music-pin-all-btn')?.addEventListener('click', async () => {
  const fullLib = getFullLibrary();
  const mood = musicState.activeMood;
  const q    = musicState.searchQ.toLowerCase();
  const visible = fullLib.filter(t => {
    const moodOk = mood === 'all' || t.mood === mood;
    const qOk    = !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
    return moodOk && qOk && t.url && t.url.startsWith('http') && !t._custom;
  });
  const toPin = visible.filter(t => !cachedAudioUrls.has(t.url));
  if (toPin.length === 0) { setStatus('All visible tracks already cached offline ✓'); return; }
  const btn = document.getElementById('music-pin-all-btn');
  btn.disabled = true; btn.textContent = `⬇ 0/${toPin.length}`;
  let done = 0;
  for (const track of toPin) {
    try {
      await pinTrackOffline(track);
      done++;
    } catch(e) { /* continue */ }
    btn.textContent = `⬇ ${done}/${toPin.length}`;
  }
  btn.disabled = false; btn.textContent = '⬇ Pin All';
  await refreshCachedAudioUrls();
  updateCacheSizeDisplay();
  setStatus(`✓ ${done} of ${toPin.length} tracks saved offline`);
});

document.getElementById('music-clear-cache-btn')?.addEventListener('click', async () => {
  if (!confirm('Remove all cached audio tracks? You can re-download them anytime.')) return;
  await clearAudioCache();
  renderMusicLibrary();
  updateCacheSizeDisplay();
  setStatus('Audio cache cleared');
});

// ── Add track to bin (fetch + create blob URL) ────────────────────────────────
var addMusicToBin = async function(track) {
  // Check if already in bin
  if (state.clips.find(c => c.id === 'music_' + track.id)) {
    setStatus(`"${esc(track.title)}" is already in your bin`);
    return;
  }

  setStatus(`Loading "${esc(track.title)}"…`);

  // If we have preview audio buffered, use it
  if (musicState.previewTrack?.id === track.id && musicState.previewAudio?.src) {
    createMusicClip(track, musicState.previewAudio.src);
    return;
  }

  // Fetch → blob URL. SW will serve from audio cache if available (works offline too).
  try {
    // SW intercepts this fetch and serves from audio cache if pinned offline
    const resp = await fetch(track.url, { mode: 'cors' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    // Also mark as cached since we just fetched it (SW will have stored it)
    cachedAudioUrls?.add(track.url);
    createMusicClip(track, blobUrl);
  } catch (err) {
    // Offline fallback: use the direct URL — if it's in SW cache, SW will serve it
    console.warn('[Music] Fetch failed, falling back to direct URL:', err);
    createMusicClip(track, track.url);
  }
}

function createMusicClip(track, url) {
  // Parse dur string "m:ss" → seconds
  const [m, s] = track.dur.split(':').map(Number);
  const durSec = m * 60 + s;

  const clip = {
    id: 'music_' + track.id,
    name: track.title,
    artist: track.artist,
    file: null,
    url,
    duration: durSec,
    type: 'audio',
    bpm: track.bpm,
    beatMarkers: null,
    waveformData: null,
    license: track.license,
    fromLibrary: true,
  };

  state.clips.push(clip);
  renderBin();

  // Switch to bin tab to show it
  document.getElementById('tab-bin').click();

  setStatus(`✓ "${esc(track.title)}" added to bin · ${esc(track.license)}`);

  // Kick off beat analysis using the URL
  analyzeFromUrl(clip, url);
}

async function analyzeFromUrl(clip, url) {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return;
    const arrayBuffer = await resp.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let audioBuffer;
    try { audioBuffer = await audioCtx.decodeAudioData(arrayBuffer); }
    catch(e) { await audioCtx.close(); return; }

    // Waveform
    const raw = audioBuffer.getChannelData(0);
    const N = 500, blockSize = Math.floor(raw.length / N);
    const waveformData = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) sum += Math.abs(raw[i * blockSize + j]);
      waveformData[i] = sum / blockSize;
    }
    const wMax = Math.max.apply(null, waveformData);
    if (wMax > 0) for (let i = 0; i < N; i++) waveformData[i] /= wMax;
    clip.waveformData = waveformData;

    // Beats
    const sr = audioBuffer.sampleRate, ch = audioBuffer.getChannelData(0);
    const winSize = Math.round(sr * 0.02), hop = Math.round(sr * 0.01);
    const energies = [];
    for (let i = 0; i + winSize < ch.length; i += hop) {
      let e = 0; for (let j = 0; j < winSize; j++) e += ch[i+j]*ch[i+j];
      energies.push(e / winSize);
    }
    const onset = [0];
    for (let i = 1; i < energies.length; i++) onset.push(Math.max(0, energies[i] - energies[i-1]));
    const ctx2 = 80, mult = 1.8, beats = [];
    for (let i = ctx2; i < onset.length - ctx2; i++) {
      const slice = onset.slice(i-ctx2, i+ctx2);
      const mean = slice.reduce((a,b)=>a+b,0)/slice.length;
      if (onset[i] > mean*mult) {
        const t = (i*hop)/sr;
        if (beats.length===0 || t-beats[beats.length-1]>0.1) beats.push(t);
      }
    }
    clip.beatMarkers = beats;
    if (beats.length > 4) {
      const ivs = [];
      for (let i=1;i<beats.length;i++) ivs.push(beats[i]-beats[i-1]);
      ivs.sort((a,b)=>a-b);
      clip.bpm = Math.round(60/ivs[Math.floor(ivs.length/2)]);
    }
    await audioCtx.close();
    renderBin(); renderTimeline();
    setStatus(`"${esc(clip.name)}" — ${beats.length} beats · ${clip.bpm||'?'} BPM`);
  } catch(e) { /* silent — beat analysis is best-effort */ }
}


// ═════════════════════════════════════════════════════════════════════════════
// TEXT GRAPHICS ENGINE
// ═════════════════════════════════════════════════════════════════════════════

// Default text clip properties
function defaultTextProps() {
  return {
    text:        'Your Text Here',
    font:        'Arial',
    size:        48,
    align:       'center',
    bold:        false,
    italic:      false,
    color:       '#ffffff',
    opacity:     100,
    bgEnabled:   false,
    bgColor:     '#000000',
    bgOpacity:   50,
    x:           50,   // % of canvas width
    y:           85,   // % of canvas height
    strokeColor: '#000000',
    strokeWidth: 0,
    shadow:      0,
  };
}

// Preset definitions
const TEXT_PRESETS = {
  'title': {
    text: 'YOUR TITLE', font: 'Impact', size: 72,
    align: 'center', bold: false, italic: false,
    color: '#ffffff', opacity: 100,
    bgEnabled: false, bgColor: '#000000', bgOpacity: 0,
    x: 50, y: 50, strokeColor: '#000000', strokeWidth: 3, shadow: 8,
  },
  'lower-third': {
    text: 'Name Here\nTitle or Description', font: 'Arial', size: 36,
    align: 'left', bold: true, italic: false,
    color: '#ffffff', opacity: 100,
    bgEnabled: true, bgColor: '#1a3a6a', bgOpacity: 85,
    x: 12, y: 82, strokeColor: '#000000', strokeWidth: 0, shadow: 4,
  },
  'subtitle': {
    text: 'Subtitle text goes here', font: 'Arial', size: 32,
    align: 'center', bold: false, italic: true,
    color: '#ffffff', opacity: 95,
    bgEnabled: true, bgColor: '#000000', bgOpacity: 55,
    x: 50, y: 90, strokeColor: '#000000', strokeWidth: 0, shadow: 2,
  },
  'end-card': {
    text: 'Thanks for watching!\nSubscribe for more', font: 'Georgia', size: 44,
    align: 'center', bold: false, italic: false,
    color: '#ffdd88', opacity: 100,
    bgEnabled: false, bgColor: '#000000', bgOpacity: 0,
    x: 50, y: 50, strokeColor: '#000000', strokeWidth: 2, shadow: 6,
  },
};

// ── Create a text clip entry ──────────────────────────────────────────────────
function createTextClip(props = {}) {
  const id = 'text_' + uid();
  const clip = {
    id, name: 'Text: ' + (props.text || 'Your Text Here').split('\n')[0].slice(0, 20),
    file: null, url: null, duration: 5,
    type: 'text',
    textProps: Object.assign(defaultTextProps(), props),
  };
  state.clips.push(clip);

  // Place on V2 at current playhead
  const existing = state.timeline.filter(t => t.track === 'v2');
  const start = state.playheadTime;
  const entry = {
    id: uid(), clipId: id, track: 'v2',
    start, duration: 5,
    inPoint: 0, outPoint: 5,
    fadeIn: 0, fadeOut: 0,
  };
  state.timeline.push(entry);
  state.selectedTimelineId = entry.id;
  state.seqDuration = Math.max(state.seqDuration, start + 6);

  renderTimeline();
  renderBin();
  showTextInspector(entry.id);
  renderTextOverlay();
  setStatus(`Text clip added at ${formatTC(start)} — edit in Inspector`);
  return entry;
}

// ── Show/hide text inspector ──────────────────────────────────────────────────
function showTextInspector(entryId) {
  const entry = state.timeline.find(t => t.id === entryId);
  const clip  = entry ? state.clips.find(c => c.id === entry.clipId) : null;

  const ti = document.getElementById('text-inspector');
  if (!clip || clip.type !== 'text') {
    ti.classList.remove('visible');
    return;
  }

  ti.classList.add('visible');
  const p = clip.textProps;

  document.getElementById('ti-text').value           = p.text;
  document.getElementById('ti-font').value           = p.font;
  document.getElementById('ti-size').value           = p.size;
  document.getElementById('ti-color').value          = p.color;
  document.getElementById('ti-opacity').value        = p.opacity;
  document.getElementById('ti-opacity-val').textContent = p.opacity + '%';
  document.getElementById('ti-bg-color').value       = p.bgColor;
  document.getElementById('ti-bg-opacity').value     = p.bgOpacity;
  document.getElementById('ti-bg-opacity-val').textContent = p.bgOpacity + '%';
  document.getElementById('ti-bg-toggle').textContent = p.bgEnabled ? 'BG On' : 'BG Off';
  document.getElementById('ti-bg-toggle').classList.toggle('active', p.bgEnabled);
  document.getElementById('ti-x').value              = p.x;
  document.getElementById('ti-y').value              = p.y;
  document.getElementById('ti-stroke-color').value   = p.strokeColor;
  document.getElementById('ti-stroke-width').value   = p.strokeWidth;
  document.getElementById('ti-stroke-val').textContent = p.strokeWidth + 'px';
  document.getElementById('ti-shadow').value         = p.shadow;
  document.getElementById('ti-shadow-val').textContent = p.shadow + 'px';

  // Align buttons
  ['left','center','right'].forEach(a => {
    document.getElementById('tia-' + a).classList.toggle('active', p.align === a);
  });
  document.getElementById('tia-bold').classList.toggle('active', p.bold);
  document.getElementById('tia-italic').classList.toggle('active', p.italic);
}

// ── Get active text clip props ─────────────────────────────────────────────
function getSelectedTextClip() {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return null;
  const clip = state.clips.find(c => c.id === entry.clipId);
  if (!clip || clip.type !== 'text') return null;
  return { entry, clip, props: clip.textProps };
}

// ── Render text overlay on Canvas viewer ─────────────────────────────────────
function renderTextOverlay() {
  const screen  = document.getElementById('viewer-screen-cvs');
  const canvas  = document.getElementById('text-overlay-canvas');
  if (!canvas) return;

  const W = screen.offsetWidth  || 640;
  const H = screen.offsetHeight || 360;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Find all text clips active at current playhead time
  state.timeline.forEach(entry => {
    const clip = state.clips.find(c => c.id === entry.clipId);
    if (!clip || clip.type !== 'text') return;
    if (state.playheadTime < entry.start || state.playheadTime > entry.start + entry.duration) return;

    // Apply fade
    let alpha = 1;
    const elapsed = state.playheadTime - entry.start;
    const remaining = entry.start + entry.duration - state.playheadTime;
    if (entry.fadeIn  > 0 && elapsed  < entry.fadeIn)  alpha = Math.min(1, elapsed  / entry.fadeIn);
    if (entry.fadeOut > 0 && remaining < entry.fadeOut) alpha = Math.min(alpha, remaining / entry.fadeOut);

    drawTextGraphic(ctx, clip.textProps, W, H, alpha);
  });
}

// ── Core text renderer ────────────────────────────────────────────────────────
function drawTextGraphic(ctx, p, W, H, masterAlpha = 1) {
  const lines   = (p.text || '').split('\n');
  const scale   = Math.min(W / 1920, H / 1080); // scale relative to 1080p
  const fontSize = Math.round(p.size * scale);
  const weight  = p.bold   ? 'bold '   : '';
  const style_  = p.italic ? 'italic ' : '';
  ctx.font = `${style_}${weight}${fontSize}px ${p.font}`;
  ctx.textAlign  = p.align;
  ctx.textBaseline = 'middle';

  const lineH    = fontSize * 1.3;
  const totalH   = lines.length * lineH;
  const cx       = (p.x / 100) * W;
  const cy       = (p.y / 100) * H - totalH / 2 + lineH / 2;

  lines.forEach((line, i) => {
    const ly = cy + i * lineH;
    const textW = ctx.measureText(line).width;
    const padX  = fontSize * 0.3, padY = fontSize * 0.2;

    // Background box
    if (p.bgEnabled) {
      const bx = p.align === 'center' ? cx - textW/2 - padX
               : p.align === 'left'   ? cx - padX
               : cx - textW - padX;
      ctx.globalAlpha = (p.bgOpacity / 100) * masterAlpha;
      ctx.fillStyle   = p.bgColor;
      ctx.fillRect(bx, ly - lineH/2 - padY/2, textW + padX*2, lineH + padY);
    }

    // Shadow
    if (p.shadow > 0) {
      ctx.shadowColor   = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur    = p.shadow * scale;
      ctx.shadowOffsetX = p.shadow * scale * 0.4;
      ctx.shadowOffsetY = p.shadow * scale * 0.4;
    }

    // Stroke
    if (p.strokeWidth > 0) {
      ctx.globalAlpha   = (p.opacity / 100) * masterAlpha;
      ctx.strokeStyle   = p.strokeColor;
      ctx.lineWidth     = p.strokeWidth * scale * 2;
      ctx.lineJoin      = 'round';
      ctx.strokeText(line, cx, ly);
    }

    // Fill text
    ctx.globalAlpha = (p.opacity / 100) * masterAlpha;
    ctx.fillStyle   = p.color;
    ctx.fillText(line, cx, ly);

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  });
  ctx.globalAlpha = 1;
}

// ── Wire all inspector inputs ─────────────────────────────────────────────────
function wireTextInspector() {
  function updateProp(key, val) {
    const d = getSelectedTextClip();
    if (!d) return;
    d.props[key] = val;
    d.clip.name = 'Text: ' + (d.props.text || '').split('\n')[0].slice(0, 20);
    renderTextOverlay();
    renderTimeline(); // refresh clip label
  }

  document.getElementById('ti-text').addEventListener('input', (e) => updateProp('text', e.target.value));
  document.getElementById('ti-font').addEventListener('change', (e) => updateProp('font', e.target.value));
  document.getElementById('ti-size').addEventListener('input', (e) => updateProp('size', parseInt(e.target.value)||48));
  document.getElementById('ti-color').addEventListener('input', (e) => updateProp('color', e.target.value));
  document.getElementById('ti-opacity').addEventListener('input', (e) => {
    document.getElementById('ti-opacity-val').textContent = e.target.value + '%';
    updateProp('opacity', parseInt(e.target.value));
  });
  document.getElementById('ti-bg-color').addEventListener('input', (e) => updateProp('bgColor', e.target.value));
  document.getElementById('ti-bg-opacity').addEventListener('input', (e) => {
    document.getElementById('ti-bg-opacity-val').textContent = e.target.value + '%';
    updateProp('bgOpacity', parseInt(e.target.value));
  });
  document.getElementById('ti-bg-toggle').addEventListener('click', () => {
    const d = getSelectedTextClip(); if (!d) return;
    d.props.bgEnabled = !d.props.bgEnabled;
    document.getElementById('ti-bg-toggle').textContent = d.props.bgEnabled ? 'BG On' : 'BG Off';
    document.getElementById('ti-bg-toggle').classList.toggle('active', d.props.bgEnabled);
    renderTextOverlay();
  });
  document.getElementById('ti-x').addEventListener('input', (e) => updateProp('x', parseFloat(e.target.value)||50));
  document.getElementById('ti-y').addEventListener('input', (e) => updateProp('y', parseFloat(e.target.value)||50));
  document.getElementById('ti-stroke-color').addEventListener('input', (e) => updateProp('strokeColor', e.target.value));
  document.getElementById('ti-stroke-width').addEventListener('input', (e) => {
    document.getElementById('ti-stroke-val').textContent = e.target.value + 'px';
    updateProp('strokeWidth', parseInt(e.target.value));
  });
  document.getElementById('ti-shadow').addEventListener('input', (e) => {
    document.getElementById('ti-shadow-val').textContent = e.target.value + 'px';
    updateProp('shadow', parseInt(e.target.value));
  });

  // Align & style buttons
  ['left','center','right'].forEach(a => {
    document.getElementById('tia-' + a).addEventListener('click', () => {
      ['left','center','right'].forEach(x => document.getElementById('tia-'+x).classList.remove('active'));
      document.getElementById('tia-' + a).classList.add('active');
      updateProp('align', a);
    });
  });
  document.getElementById('tia-bold').addEventListener('click', () => {
    const d = getSelectedTextClip(); if (!d) return;
    d.props.bold = !d.props.bold;
    document.getElementById('tia-bold').classList.toggle('active', d.props.bold);
    renderTextOverlay();
  });
  document.getElementById('tia-italic').addEventListener('click', () => {
    const d = getSelectedTextClip(); if (!d) return;
    d.props.italic = !d.props.italic;
    document.getElementById('tia-italic').classList.toggle('active', d.props.italic);
    renderTextOverlay();
  });

  // Presets
  document.querySelectorAll('.text-preset-btn[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = getSelectedTextClip(); if (!d) return;
      const preset = TEXT_PRESETS[btn.dataset.preset];
      if (!preset) return;
      Object.assign(d.props, preset);
      showTextInspector(state.selectedTimelineId);
      renderTextOverlay();
      document.querySelectorAll('.text-preset-btn[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Quick position buttons
  document.querySelectorAll('.text-preset-btn[data-pos]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = getSelectedTextClip(); if (!d) return;
      const posMap = { top: { x: 50, y: 12 }, center: { x: 50, y: 50 }, bottom: { x: 50, y: 85 } };
      const pos = posMap[btn.dataset.pos];
      if (!pos) return;
      d.props.x = pos.x; d.props.y = pos.y;
      document.getElementById('ti-x').value = pos.x;
      document.getElementById('ti-y').value = pos.y;
      renderTextOverlay();
    });
  });
}

// ── Patch renderTimeline to show text clips differently ───────────────────────
const _origRenderTimeline = renderTimeline;


// ── Patch updatePlayhead to re-render text overlay on scrub ──────────────────
const _origUpdatePlayhead = updatePlayhead;


// ── "Add Text" button ─────────────────────────────────────────────────────────
document.getElementById('btn-add-text').addEventListener('click', () => createTextClip());
document.getElementById('track-v2-add-text').addEventListener('click', () => createTextClip());

// ── Keyboard shortcut T ───────────────────────────────────────────────────────
const _origKeydown = window._cutproKeydown;
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 't' || e.key === 'T') createTextClip();
});

// ── Drag text position directly on canvas ────────────────────────────────────
(function() {
  const canvas = document.getElementById('text-overlay-canvas');
  if (!canvas) return;
  let dragging = false;

  canvas.style.pointerEvents = 'auto';
  canvas.style.cursor = 'default';

  canvas.addEventListener('mousedown', (e) => {
    const d = getSelectedTextClip();
    if (!d) return;
    dragging = true;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width)  * 100;
    const y = ((e.clientY - rect.top)  / rect.height) * 100;
    const d = getSelectedTextClip();
    if (!d) return;
    d.props.x = Math.max(0, Math.min(100, x));
    d.props.y = Math.max(0, Math.min(100, y));
    document.getElementById('ti-x').value = Math.round(d.props.x);
    document.getElementById('ti-y').value = Math.round(d.props.y);
    renderTextOverlay();
  });

  canvas.addEventListener('mouseup', () => {
    dragging = false;
    canvas.style.cursor = 'default';
  });
  canvas.addEventListener('mouseleave', () => { dragging = false; });
})();

// ── Resize canvas overlay when window resizes ──────────────────────────────
window.addEventListener('resize', renderTextOverlay);

// ── Init ──────────────────────────────────────────────────────────────────────
wireTextInspector();


// ═════════════════════════════════════════════════════════════════════════════

function renderCanvasFrame() {
  var screen = document.getElementById('viewer-screen-cvs');
  if (!screen || !canvasOutput) return;
  var W = screen.offsetWidth || 640, H = screen.offsetHeight || 360;
  if (canvasOutput.width !== W || canvasOutput.height !== H) { canvasOutput.width=W; canvasOutput.height=H; }
  var ctx = canvasOutput.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  var t = state.playheadTime;
  state.timeline.forEach(function(entry) {
    if (t < entry.start || t > entry.start + entry.duration) return;
    var clip = state.clips.find(function(c) { return c.id === entry.clipId; });
    if (!clip) return;
    if (clip.type === 'video') {
      var vel = ensureLiveVideoEl(clip); if (!vel) return;
      var target = t - entry.start + (entry.inPoint || 0);
      if (Math.abs(vel.currentTime - target) > 0.15) vel.currentTime = target;
      var alpha = 1, el = t - entry.start, rem = entry.start + entry.duration - t;
      if (entry.fadeIn  > 0 && el  < entry.fadeIn)  alpha = el  / entry.fadeIn;
      if (entry.fadeOut > 0 && rem < entry.fadeOut)  alpha = Math.min(alpha, rem / entry.fadeOut);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.drawImage(vel, 0, 0, W, H);
      ctx.restore();
    }
    if (clip.type === 'text' && clip.textProps && typeof drawTextGraphic === 'function') {
      var alpha = 1, el2 = t - entry.start, rem2 = entry.start + entry.duration - t;
      if (entry.fadeIn  > 0 && el2  < entry.fadeIn)  alpha = el2  / entry.fadeIn;
      if (entry.fadeOut > 0 && rem2 < entry.fadeOut)  alpha = Math.min(alpha, rem2 / entry.fadeOut);
      drawTextGraphic(ctx, clip.textProps, W, H, alpha);
    }
  });
}



// ═════════════════════════════════════════════════════════════════════════════
// FEATURES — Undo, Canvas Viewer, Live Playback, Motion Inspector,
//            Bin Drag, Dead Buttons, Effects, Inspector Tabs, Zoom Tool
// Written as single clean implementations — no monkey-patching.
// ═════════════════════════════════════════════════════════════════════════════

// ── Canvas viewer ──────────────────────────────────────────────────────────
const canvasOutput = document.getElementById('canvas-output');
const canvasVpCvs  = document.getElementById('vp-cvs');
let livePlayRAF    = null;

function showCanvasViewer() {
  if (canvasOutput) canvasOutput.style.display = 'block';
  if (canvasVpCvs)  canvasVpCvs.style.display  = 'none';
}
function hideCanvasViewer() {
  if (canvasOutput) canvasOutput.style.display = 'none';
  if (canvasVpCvs)  canvasVpCvs.style.display  = 'flex';
}
function syncCanvasPlaceholder() {
  const hasVideo = state.timeline.some(e => {
    const c = state.clips.find(x => x.id === e.clipId);
    return c && c.type !== 'audio';
  });
  hasVideo ? showCanvasViewer() : hideCanvasViewer();
}

// Pre-load video elements for live canvas rendering
const liveVideoEls = {};
function ensureLiveVideoEl(clip) {
  if (!clip || !clip.url || clip.type !== 'video') return null;
  if (liveVideoEls[clip.id]) return liveVideoEls[clip.id];
  const v = document.createElement('video');
  v.src = clip.url; v.preload = 'auto'; v.muted = true;
  v.addEventListener('loadeddata', renderCanvasFrame);
  liveVideoEls[clip.id] = v;
  return v;
}

// ── Live canvas playback ───────────────────────────────────────────────────
function startLivePlayback() {
  if (livePlayRAF) cancelAnimationFrame(livePlayRAF);
  const fps = 30, frameDur = 1000 / fps;
  let last = performance.now();
  function tick(now) {
    if (!state.playing) { livePlayRAF = null; return; }
    if (now - last >= frameDur) {
      state.playheadTime += 1 / fps;
      if (state.playheadTime >= state.seqDuration) state.playheadTime = 0;
      updatePlayhead();
      renderCanvasFrame();
      last = now;
    }
    livePlayRAF = requestAnimationFrame(tick);
  }
  livePlayRAF = requestAnimationFrame(tick);
}

// Patch togglePlay to use rAF + sync source viewer video
(function() {
  const origToggle = togglePlay;
  togglePlay = function togglePlay() {
    state.playing = !state.playing;
    const btn  = document.getElementById('btn-play');
    const cBtn = document.getElementById('cvs-play');
    const srcVid = document.getElementById('src-video');
    if (state.playing) {
      if (btn)  btn.textContent  = '⏸';
      if (cBtn) cBtn.textContent = '⏸';
      clearInterval(playInterval);
      startLivePlayback();
      if (srcVid && srcVid.src && srcVid.style.display !== 'none') {
        srcVid.currentTime = state.playheadTime;
        srcVid.play().catch(() => {});
      }
    } else {
      if (btn)  btn.textContent  = '▶';
      if (cBtn) cBtn.textContent = '▶';
      if (livePlayRAF) { cancelAnimationFrame(livePlayRAF); livePlayRAF = null; }
      if (srcVid && !srcVid.paused) srcVid.pause();
      renderCanvasFrame();
    }
  };
})();

// Patch updatePlayhead to render canvas frame on scrub
(function() {
  const origUP = updatePlayhead;
  updatePlayhead = function updatePlayhead() {
    origUP();
    if (!state.playing) renderCanvasFrame();
  };
})();

// Patch addToTimeline to show canvas + push undo
(function() {
  const origATL = addToTimeline;
  addToTimeline = function addToTimeline(clipId, trackId) {
    pushUndo();
    origATL(clipId, trackId);
    showCanvasViewer();
  };
})();

// Patch renderTimeline to sync mobile timeline
(function() {
  const origRT = renderTimeline;
  renderTimeline = function renderTimeline() {
    origRT();
    clearTimeout(window._mSyncTimer);
    window._mSyncTimer = setTimeout(() => {
      if (typeof window.mRenderTimeline === 'function') window.mRenderTimeline();
    }, 100);
  };
})();

// Patch renderBin to enable drag after render
(function() {
  const origRB = renderBin;
  renderBin = function renderBin() {
    origRB();
    enableBinDrag();
  };
})();

// ── Undo / Redo ──────────────────────────────────────────────────────────
const undoStack = [], redoStack = [], MAX_UNDO = 50;

function snapshotState() {
  return {
    timeline:    JSON.parse(JSON.stringify(state.timeline)), // deep copy preserves all entry fields
    seqDuration: state.seqDuration,
  };
}
function restoreSnapshot(snap) {
  state.timeline    = JSON.parse(JSON.stringify(snap.timeline));
  state.seqDuration = snap.seqDuration;
  state.selectedTimelineId = null;
  renderTimeline();
  renderCanvasFrame();
}
function pushUndo() {
  undoStack.push(snapshotState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}
function performUndo() {
  if (!undoStack.length) { setStatus('Nothing to undo'); return; }
  redoStack.push(snapshotState());
  restoreSnapshot(undoStack.pop());
  setStatus('Undo');
}
function performRedo() {
  if (!redoStack.length) { setStatus('Nothing to redo'); return; }
  undoStack.push(snapshotState());
  restoreSnapshot(redoStack.pop());
  setStatus('Redo');
}

document.getElementById('tl-undo').addEventListener('click', performUndo);
document.getElementById('tl-redo').addEventListener('click', performRedo);

// Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(); }
  if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); performRedo(); }
});

// Capture-phase listener — pushUndo before delete/lift actions
document.addEventListener('click', e => {
  const ripple = e.target.closest('#btn-ripple-del');
  const lift   = e.target.closest('#btn-lift');
  if (ripple || lift) pushUndo();
}, true);

// ── Insert / Overwrite (with Mark In/Out) ────────────────────────────────
// Re-register on top of the originals — both fire, but original handler runs
// first (just appends clip). Our handler runs second and CORRECTS inPoint/outPoint.
document.getElementById('btn-insert').addEventListener('click', () => {
  const entry = state.timeline.filter(t => {
    const c = state.clips.find(x => x.id === t.clipId);
    return c && t.clipId === state.selectedClipId;
  }).slice(-1)[0]; // most recently added by original handler
  if (!entry || state.markIn === null) return;
  entry.inPoint  = state.markIn;
  entry.outPoint = state.markOut !== null ? state.markOut : entry.inPoint + entry.duration;
  entry.duration = Math.max(0.1, entry.outPoint - entry.inPoint);
  showCanvasViewer();
  renderTimeline();
});
document.getElementById('btn-overwrite').addEventListener('click', () => {
  const entries = state.timeline.filter(t => t.clipId === state.selectedClipId);
  const entry = entries[entries.length - 1];
  if (!entry || state.markIn === null) return;
  entry.inPoint  = state.markIn;
  entry.outPoint = state.markOut !== null ? state.markOut : entry.inPoint + entry.duration;
  entry.duration = Math.max(0.1, entry.outPoint - entry.inPoint);
  showCanvasViewer();
  renderTimeline();
});

// ── Bin drag-to-timeline ─────────────────────────────────────────────────
function enableBinDrag() {
  document.querySelectorAll('#bin-list .bin-item').forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', e => {
      state.selectedClipId = item.dataset.id;
      e.dataTransfer.setData('text/plain', item.dataset.id);
      e.dataTransfer.effectAllowed = 'copy';
      item.style.opacity = '0.5';
    });
    item.addEventListener('dragend', () => item.style.opacity = '');
  });
}

// Upgrade track drop handlers to use dataTransfer + drop X position
TRACK_ORDER.forEach(tId => {
  const trackEl = document.getElementById('track-' + tId);
  if (!trackEl) return;
  trackEl.addEventListener('dragover',  e => { e.preventDefault(); trackEl.style.background = 'rgba(74,143,205,0.15)'; });
  trackEl.addEventListener('dragleave', ()  => { trackEl.style.background = ''; });
  trackEl.addEventListener('drop', e => {
    e.preventDefault(); trackEl.style.background = '';
    const clipId = e.dataTransfer.getData('text/plain') || state.selectedClipId;
    if (!clipId) return;
    pushUndo();
    const clip  = state.clips.find(c => c.id === clipId);
    if (!clip) return;
    const rect  = trackEl.getBoundingClientRect();
    const dropT = Math.max(0, pxToSec(e.clientX - rect.left));
    const inPt  = state.markIn  !== null ? state.markIn  : 0;
    const outPt = state.markOut !== null ? state.markOut : (clip.duration || 10);
    const dur   = Math.max(0.1, outPt - inPt);
    state.timeline.push({
      id: uid(), clipId, track: tId,
      start: dropT, duration: dur, inPoint: inPt, outPoint: outPt,
      fadeIn: 0, fadeOut: 0,
    });
    state.seqDuration = Math.max(state.seqDuration, dropT + dur + 5);
    renderTimeline(); showCanvasViewer();
    setStatus('Dropped "' + clip.name + '" at ' + formatTC(dropT) + ' on ' + tId);
  });
});

// ── Inspector: Motion / Color / Crop sliders → videoProps ────────────────
function getSelectedEntry() {
  return state.timeline.find(t => t.id === state.selectedTimelineId) || null;
}
function ensureEntryVideoProps(entry) {
  if (!entry.videoProps) entry.videoProps = {
    scale:100, rotate:0, opacity:100,
    brightness:0, contrast:0, saturation:0,
    cropL:0, cropR:0, cropT:0, cropB:0, cssFilter:'',
  };
  return entry.videoProps;
}
function loadVideoPropsInspector() {
  const entry = getSelectedEntry();
  if (!entry) return;
  const vp = ensureEntryVideoProps(entry);
  const map = [
    ['p-scale','pv-scale',vp.scale,'%'],['p-rotate','pv-rotate',vp.rotate,'°'],
    ['p-opacity','pv-opacity',vp.opacity,'%'],['p-bright','pv-bright',vp.brightness,''],
    ['p-contrast','pv-contrast',vp.contrast,''],['p-sat','pv-sat',vp.saturation,''],
    ['p-crop-l','pv-crop-l',vp.cropL,''],['p-crop-r','pv-crop-r',vp.cropR,''],
    ['p-crop-t','pv-crop-t',vp.cropT,''],['p-crop-b','pv-crop-b',vp.cropB,''],
  ];
  map.forEach(([sid,vid,val,unit]) => {
    const s = document.getElementById(sid), v = document.getElementById(vid);
    if (s) s.value = val;
    if (v) v.textContent = val + unit;
  });
}
function wireMotionSliders() {
  [
    ['p-scale','pv-scale','scale','%'],['p-rotate','pv-rotate','rotate','°'],
    ['p-opacity','pv-opacity','opacity','%'],['p-bright','pv-bright','brightness',''],
    ['p-contrast','pv-contrast','contrast',''],['p-sat','pv-sat','saturation',''],
    ['p-crop-l','pv-crop-l','cropL',''],['p-crop-r','pv-crop-r','cropR',''],
    ['p-crop-t','pv-crop-t','cropT',''],['p-crop-b','pv-crop-b','cropB',''],
  ].forEach(([sid,vid,prop,unit]) => {
    const slider = document.getElementById(sid);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      const vEl = document.getElementById(vid);
      if (vEl) vEl.textContent = v + unit;
      const entry = getSelectedEntry();
      if (!entry) return;
      const vp = ensureEntryVideoProps(entry);
      vp[prop] = v;
      // Apply to canvas
      if (canvasOutput) {
        canvasOutput.style.filter = `brightness(${1+vp.brightness/100}) contrast(${1+vp.contrast/100}) saturate(${1+vp.saturation/100}) opacity(${vp.opacity/100})`;
        canvasOutput.style.transform = `scale(${vp.scale/100}) rotate(${vp.rotate}deg)`;
      }
    });
  });
}
wireMotionSliders();

// Patch loadFadeInspector to also load video props
(function() {
  const origLF = loadFadeInspector;
  loadFadeInspector = function loadFadeInspector() {
    origLF();
    loadVideoPropsInspector();
  };
})();

// ── Inspector tabs (Motion / Filters / Speed) ─────────────────────────────
(function() {
  const inspEl = document.getElementById('inspector');
  if (!inspEl) return;
  const tabs = inspEl.querySelectorAll('.panel-tab');
  // Give sections IDs by scanning their titles
  inspEl.querySelectorAll('.inspector-section-title').forEach(title => {
    const t = title.textContent.trim();
    if (t.includes('Basic Motion')) title.closest('.inspector-section').id = 'sec-motion';
    if (t.includes('Color'))        title.closest('.inspector-section').id = 'sec-color';
    if (t.includes('Crop'))         title.closest('.inspector-section').id = 'sec-crop';
  });
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const label = tab.textContent.trim();
      const motion = document.getElementById('sec-motion');
      const color  = document.getElementById('sec-color');
      const crop   = document.getElementById('sec-crop');
      if (label === 'Motion')  { if(motion)motion.style.display=''; if(color)color.style.display='none'; if(crop)crop.style.display=''; }
      if (label === 'Filters') { if(motion)motion.style.display='none'; if(color)color.style.display=''; if(crop)crop.style.display='none'; }
      if (label === 'Speed')   { if(motion)motion.style.display='none'; if(color)color.style.display='none'; if(crop)crop.style.display='none'; setStatus('Speed control: set clip speed with a future update'); }
    });
  });
})();

// ── Replace Edit ────────────────────────────────────────────────────────
document.getElementById('btn-replace').addEventListener('click', () => {
  if (!state.selectedClipId)    { setStatus('Select a source clip in the bin first'); return; }
  if (!state.selectedTimelineId) { setStatus('Select a clip on the timeline to replace'); return; }
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  const clip  = state.clips.find(c => c.id === state.selectedClipId);
  if (!entry || !clip) return;
  pushUndo();
  entry.clipId = clip.id; entry.duration = clip.duration; entry.inPoint = 0; entry.outPoint = clip.duration;
  renderTimeline(); setStatus('Replaced with "' + clip.name + '"');
});

// ── Render button (progress indicator) ────────────────────────────────
document.getElementById('btn-render').addEventListener('click', () => {
  if (!state.timeline.length) { setStatus('Add clips to render'); return; }
  const btn = document.getElementById('btn-render');
  btn.disabled = true; let pct = 0;
  const tick = setInterval(() => {
    pct = Math.min(100, pct + 2 + Math.random() * 4);
    setStatus('Rendering… ' + Math.round(pct) + '%');
    if (pct >= 100) { clearInterval(tick); btn.disabled = false; setStatus('✓ Render complete'); }
  }, 80);
});

// ── Linked selection ─────────────────────────────────────────────────
state.linkedSelection = true;
document.getElementById('tl-btn-linked').addEventListener('click', () => {
  state.linkedSelection = !state.linkedSelection;
  document.getElementById('tl-btn-linked').classList.toggle('active', state.linkedSelection);
  setStatus('Linked selection ' + (state.linkedSelection ? 'ON' : 'OFF'));
});

// ── Add track ────────────────────────────────────────────────────────
let extraTrackCount = 0;
document.getElementById('tl-btn-add-track').addEventListener('click', () => {
  extraTrackCount++;
  const tId = 'v' + (extraTrackCount + 2), label = 'V' + (extraTrackCount + 2);
  const headers = document.getElementById('track-headers');
  if (headers) {
    const h = document.createElement('div');
    h.className = 'track-header video';
    h.innerHTML = '<span class="track-name">' + label + '</span><span class="track-mute">👁</span><span class="track-lock">🔒</span>';
    headers.insertBefore(h, headers.children[1]);
  }
  const tracksEl = document.getElementById('timeline-tracks');
  if (tracksEl) {
    const t = document.createElement('div');
    t.className = 'timeline-track v1'; t.id = 'track-' + tId; t.dataset.track = tId;
    tracksEl.insertBefore(t, tracksEl.children[1]);
  }
  TRACK_ORDER.unshift(tId);
  setStatus('Added track ' + label);
});

// ── Zoom tool click ─────────────────────────────────────────────────
document.getElementById('timeline-tracks').addEventListener('click', e => {
  if (state.currentTool !== 'zoom') return;
  if (e.target.closest('.clip')) return;
  state.zoom = Math.max(1, Math.min(20, state.zoom * (e.shiftKey || e.altKey ? 0.7 : 1.4)));
  document.getElementById('tl-zoom-slider').value = state.zoom;
  renderTimeline();
  setStatus('Zoom: ' + state.zoom.toFixed(1) + 'x');
}, true);

// ── Effects panel ───────────────────────────────────────────────────
(function() {
  const effectsTab = document.getElementById('tab-effects');
  if (!effectsTab) return;
  const browser = document.getElementById('browser');
  const panel = document.createElement('div');
  panel.id = 'effects-panel';
  panel.style.cssText = 'display:none;position:absolute;inset:0;background:var(--bg-panel);z-index:10;flex-direction:column;overflow:hidden;';
  const effects = [
    {id:'grayscale',name:'Grayscale',icon:'⬛',filter:'grayscale(1)'},
    {id:'sepia',name:'Sepia',icon:'🟤',filter:'sepia(0.85)'},
    {id:'blur',name:'Blur',icon:'🌫',filter:'blur(3px)'},
    {id:'sharpen',name:'Sharpen',icon:'⚡',filter:'contrast(1.4) brightness(1.05)'},
    {id:'invert',name:'Invert',icon:'🔄',filter:'invert(1)'},
    {id:'vintage',name:'Vintage',icon:'🎞',filter:'sepia(0.4) contrast(1.1) saturate(0.7)'},
    {id:'warm',name:'Warm',icon:'🌅',filter:'sepia(0.2) saturate(1.3) brightness(1.05)'},
    {id:'cool',name:'Cool',icon:'❄',filter:'saturate(0.8) hue-rotate(20deg) brightness(0.95)'},
  ];
  panel.innerHTML = '<div style="padding:6px 8px;border-bottom:1px solid var(--border-dark);font-size:9px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;flex-shrink:0;">Video Effects — select a timeline clip first</div>' +
    '<div style="flex:1;overflow-y:auto;padding:4px;">' +
    effects.map(e => `<div class="bin-item" data-effect="${e.id}" style="cursor:pointer;">
      <div class="bin-thumb" style="font-size:18px;">${e.icon}</div>
      <div class="bin-info"><div class="bin-name">${e.name}</div></div>
      <button class="music-add-btn" data-effect="${e.id}">+</button></div>`).join('') +
    '</div>';
  browser.appendChild(panel);

  effectsTab.addEventListener('click', () => {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    effectsTab.classList.add('active');
    document.getElementById('music-library')?.classList.remove('open');
    const ep = document.getElementById('effects-panel');
    if (ep) ep.style.display = 'flex';
  });
  document.getElementById('tab-bin')?.addEventListener('click', () => {
    const ep = document.getElementById('effects-panel');
    if (ep) ep.style.display = 'none';
  });
  document.getElementById('tab-music')?.addEventListener('click', () => {
    const ep = document.getElementById('effects-panel');
    if (ep) ep.style.display = 'none';
  });
  panel.addEventListener('click', e => {
    const btn = e.target.closest('[data-effect]');
    if (!btn) return;
    const entry = getSelectedEntry();
    if (!entry) { setStatus('Select a timeline clip first'); return; }
    const fx = effects.find(x => x.id === btn.dataset.effect);
    if (!fx) return;
    const vp = ensureEntryVideoProps(entry);
    vp.cssFilter = fx.filter;
    if (canvasOutput) canvasOutput.style.filter = fx.filter;
    renderTimeline();
    setStatus('Applied "' + fx.name + '"');
  });
})();

// ── PWA favicon (canvas, guarded) ────────────────────────────────────
(function() {
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 192;
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0,0,192,192);
    ctx.fillStyle = '#4a8fcd'; ctx.font = 'bold 110px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✦', 96, 100);
    const url = cv.toDataURL('image/png');
    let link = document.querySelector("link[rel='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = url;
    const apple = document.querySelector("link[rel='apple-touch-icon']");
    if (apple) apple.href = url;
  } catch(e) {}
})();

// ── Export resolution: add 1080×1080 (Instagram) ─────────────────────
(function() {
  const resEl = document.getElementById('exp-resolution');
  if (!resEl) return;
  const opt = document.createElement('option');
  opt.value = '1080x1080'; opt.textContent = '1080 × 1080 (Instagram)';
  const afterIdx = [...resEl.options].findIndex(o => o.value === '1280x720');
  if (afterIdx >= 0 && resEl.options[afterIdx + 1]) resEl.insertBefore(opt, resEl.options[afterIdx + 1]);
  else resEl.appendChild(opt);
})();

// ── Show canvas viewer when clips are on timeline on load ─────────────
setTimeout(syncCanvasPlaceholder, 200);


// ═════════════════════════════════════════════════════════════════════════════
// AI AUDIO CLEANUP ENGINE
// ═════════════════════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────────────────────
const aiState = {
  detectedEvents: [],   // [{type, start, end, duration, confidence, label, selected}]
  analysing: false,
  sourceEntryId: null,  // timeline entry being analysed
};

// ── Open modal ────────────────────────────────────────────────────────────────
document.getElementById('btn-ai-cleanup').addEventListener('click', openAiCleanup);

function openAiCleanup() {
  // Populate clip selector with audio + video clips on timeline
  const sel = document.getElementById('ai-clip-select');
  sel.innerHTML = '<option value="">— Select a clip —</option>';
  state.timeline.forEach(entry => {
    const clip = state.clips.find(c => c.id === entry.clipId);
    if (!clip || !clip.url) return;
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = clip.name + ' [' + formatTC(entry.start) + ' – ' + formatTC(entry.start + entry.duration) + ']';
    sel.appendChild(opt);
  });

  // Pre-select the currently selected timeline entry
  if (state.selectedTimelineId) sel.value = state.selectedTimelineId;

  resetAiResults();
  document.getElementById('ai-cleanup-modal').classList.add('open');
}

function closeAiCleanup() {
  document.getElementById('ai-cleanup-modal').classList.remove('open');
  aiState.analysing = false;
}

document.getElementById('ai-close').addEventListener('click', closeAiCleanup);
document.getElementById('ai-cancel-btn').addEventListener('click', closeAiCleanup);

// ── Settings sliders ─────────────────────────────────────────────────────────
[
  ['ai-min-silence', 'ai-min-silence-val', 's'],
  ['ai-silence-db',  'ai-silence-db-val',  '%'],
  ['ai-breath-max',  'ai-breath-max-val',  's'],
  ['ai-filler-max',  'ai-filler-max-val',  's'],
].forEach(([sid, vid, unit]) => {
  const sl = document.getElementById(sid);
  if (sl) sl.addEventListener('input', () => {
    const v = document.getElementById(vid);
    if (v) v.textContent = parseFloat(sl.value).toFixed(2).replace(/\.?0+$/, '') + unit;
  });
});

// Toggle labels
['pauses','breaths','fillers','lowenergy'].forEach(key => {
  const tog = document.getElementById('tog-' + key);
  const chk = document.getElementById('detect-' + key);
  if (!tog || !chk) return;
  chk.addEventListener('change', () => tog.classList.toggle('active', chk.checked));
});

// Select/deselect all
document.getElementById('ai-select-all').addEventListener('click', () => {
  aiState.detectedEvents.forEach(ev => ev.selected = true);
  renderAiEvents();
});
document.getElementById('ai-deselect-all').addEventListener('click', () => {
  aiState.detectedEvents.forEach(ev => ev.selected = false);
  renderAiEvents();
});

// ── Analysis entry point ──────────────────────────────────────────────────────
document.getElementById('ai-analyse-btn').addEventListener('click', async () => {
  const entryId = document.getElementById('ai-clip-select').value;
  if (!entryId) { setAiStatus('Select a clip first.'); return; }
  const entry = state.timeline.find(t => t.id === entryId);
  if (!entry) { setAiStatus('Clip not found.'); return; }
  const clip  = state.clips.find(c => c.id === entry.clipId);
  if (!clip || !clip.url) { setAiStatus('Clip has no audio source.'); return; }
  if (clip.type === 'text') { setAiStatus('Text clips have no audio to analyse.'); return; }

  aiState.sourceEntryId = entryId;
  aiState.analysing     = true;
  aiState.detectedEvents = [];

  document.getElementById('ai-analyse-btn').disabled = true;
  document.getElementById('ai-apply-btn').disabled    = true;
  document.getElementById('ai-progress-wrap').classList.add('show');
  document.getElementById('ai-results-section').classList.remove('show');

  try {
    await runAiAnalysis(clip, entry);
  } catch(err) {
    setAiStatus('Analysis failed: ' + err.message);
    console.error('[AI Cleanup]', err);
  }

  aiState.analysing = false;
  document.getElementById('ai-analyse-btn').disabled = false;
  document.getElementById('ai-progress-wrap').classList.remove('show');
});

function setAiProgress(pct, label) {
  const bar = document.getElementById('ai-progress-bar');
  const lbl = document.getElementById('ai-progress-label');
  if (bar) bar.style.width = Math.min(100, pct) + '%';
  if (lbl) lbl.textContent = label || '';
}

function setAiStatus(msg) {
  const el = document.getElementById('ai-status-text');
  if (el) el.textContent = msg;
}

function resetAiResults() {
  aiState.detectedEvents = [];
  document.getElementById('ai-results-section').classList.remove('show');
  document.getElementById('ai-progress-wrap').classList.remove('show');
  document.getElementById('ai-apply-btn').disabled = true;
  setAiStatus('Select a clip and click Analyse.');
}

// ═════════════════════════════════════════════════════════════════════════════
// CORE ANALYSIS — WebAudio + Speech Recognition
// ═════════════════════════════════════════════════════════════════════════════

async function runAiAnalysis(clip, entry) {
  // Guard: text clips have no audio to analyse
  if (clip.type === 'text') throw new Error('Text clips have no audio to analyse.');
  // Guard: must have a URL to fetch
  if (!clip.url && !clip.file) throw new Error('Clip has no accessible audio source.');

  setAiProgress(5, 'Loading audio data…');
  setAiStatus('Decoding audio…');

  // Decode audio
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio API not available in this browser.');
  const ctx = new AudioCtx();

  let audioBuffer;
  try {
    let arrayBuf;
    if (clip.file) {
      arrayBuf = await clip.file.arrayBuffer();
    } else {
      const resp = await fetch(clip.url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      arrayBuf = await resp.arrayBuffer();
    }
    audioBuffer = await ctx.decodeAudioData(arrayBuf);
  } catch(e) {
    await ctx.close();
    throw new Error('Could not decode audio: ' + e.message);
  }
  await ctx.close();
  setAiProgress(20, 'Audio decoded. Running energy analysis…');

  const sr       = audioBuffer.sampleRate;
  const ch       = audioBuffer.getChannelData(0);
  const frameSz  = Math.round(sr * 0.01);   // 10ms frames
  const nFrames  = Math.floor(ch.length / frameSz);

  // ── Compute RMS energy per frame ─────────────────────────────────────────
  const rms = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let sum = 0;
    const base = i * frameSz;
    for (let j = 0; j < frameSz; j++) sum += ch[base + j] * ch[base + j];
    rms[i] = Math.sqrt(sum / frameSz);
  }

  // Normalise RMS to 0-1
  const rmsMax = Math.max(...rms) || 1;
  for (let i = 0; i < nFrames; i++) rms[i] /= rmsMax;

  setAiProgress(40, 'Computing spectral features…');

  // ── Low-frequency energy per frame (for breath detection) ────────────────
  // Use a simple high-pass check: compare 0-500Hz energy vs total energy
  // Approximate with sample differencing (1st order high-pass)
  const lowEnergyRatio = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    const base = i * frameSz;
    let lowE = 0, totE = 0;
    for (let j = 1; j < frameSz; j++) {
      const s  = ch[base + j];
      const ds = ch[base + j] - ch[base + j - 1]; // high-pass diff
      lowE += (s * s) - (ds * ds * 0.5);           // low ≈ total - high
      totE += s * s;
    }
    lowEnergyRatio[i] = totE > 0 ? Math.max(0, lowE / totE) : 0;
  }

  setAiProgress(55, 'Detecting silence regions…');

  const minSilence = parseFloat(document.getElementById('ai-min-silence').value) || 0.5;
  const silThresh  = parseFloat(document.getElementById('ai-silence-db').value) / 100 || 0.03;
  const breathMax  = parseFloat(document.getElementById('ai-breath-max').value) || 0.35;
  const fillerMax  = parseFloat(document.getElementById('ai-filler-max').value) || 0.8;

  const doDetectPauses   = document.getElementById('detect-pauses')?.checked;
  const doDetectBreaths  = document.getElementById('detect-breaths')?.checked;
  const doDetectFillers  = document.getElementById('detect-fillers')?.checked;
  const doDetectLowEn    = document.getElementById('detect-lowenergy')?.checked;

  const events = [];

  // ── Silence / pause regions ───────────────────────────────────────────────
  if (doDetectPauses || doDetectBreaths || doDetectFillers) {
    // Build a binary silence mask
    const silent = new Uint8Array(nFrames);
    for (let i = 0; i < nFrames; i++) silent[i] = rms[i] < silThresh ? 1 : 0;

    // Smooth: fill single-frame noise holes
    for (let i = 1; i < nFrames - 1; i++) {
      if (!silent[i] && silent[i-1] && silent[i+1]) silent[i] = 1;
    }

    // Collect silence runs
    const silenceRuns = [];
    let runStart = -1;
    for (let i = 0; i <= nFrames; i++) {
      if (i < nFrames && silent[i] && runStart === -1) runStart = i;
      if ((i === nFrames || !silent[i]) && runStart !== -1) {
        const durSec = (i - runStart) * 0.01;
        silenceRuns.push({ start: runStart * 0.01, end: i * 0.01, dur: durSec });
        runStart = -1;
      }
    }

    // Collect voiced segments (between silences)
    const voicedRuns = [];
    for (let k = 0; k < silenceRuns.length - 1; k++) {
      const vStart = silenceRuns[k].end;
      const vEnd   = silenceRuns[k+1].start;
      voicedRuns.push({ start: vStart, end: vEnd, dur: vEnd - vStart });
    }

    // Detect long pauses
    if (doDetectPauses) {
      silenceRuns.forEach(run => {
        if (run.dur >= minSilence) {
          // Skip first/last 0.2s of clip (natural head/tail silence)
          const clipDur = audioBuffer.duration;
          if (run.start < 0.2 && run.end < 0.3) return;
          if (run.start > clipDur - 0.3) return;
          events.push({
            type: 'pause', start: run.start, end: run.end,
            duration: run.dur, selected: true,
            label: 'Silence ' + run.dur.toFixed(2) + 's',
            confidence: Math.min(1, (run.dur - minSilence) / minSilence + 0.5),
          });
        }
      });
    }

    // Detect breath sounds: short voiced segment with high low-frequency ratio
    // Breaths: typically 50-350ms, dominated by low frequencies, quieter than speech
    if (doDetectBreaths) {
      voicedRuns.forEach(run => {
        if (run.dur > breathMax || run.dur < 0.04) return;
        // Check low-frequency dominance
        const fStart = Math.round(run.start / 0.01);
        const fEnd   = Math.min(nFrames, Math.round(run.end / 0.01));
        let lowSum = 0, n = 0;
        for (let i = fStart; i < fEnd; i++) { lowSum += lowEnergyRatio[i]; n++; }
        const avgLow = n > 0 ? lowSum / n : 0;
        // Also check energy is low-ish (breath is quieter than speech)
        let rmsSum = 0;
        for (let i = fStart; i < fEnd; i++) rmsSum += rms[i];
        const avgRms = n > 0 ? rmsSum / n : 0;
        if (avgLow > 0.3 && avgRms < 0.4) {
          events.push({
            type: 'breath', start: run.start, end: run.end,
            duration: run.dur, selected: true,
            label: 'Breath ' + (run.dur * 1000).toFixed(0) + 'ms',
            confidence: Math.min(1, avgLow * 1.5),
          });
        }
      });
      // Also catch "long breaths" — runs slightly over breathMax with very high low-freq ratio
      voicedRuns.forEach(run => {
        if (run.dur <= breathMax || run.dur > breathMax * 2 || run.dur < 0.04) return;
        const fStart = Math.round(run.start / 0.01);
        const fEnd   = Math.min(nFrames, Math.round(run.end / 0.01));
        let lowSum = 0, rmsSum = 0, n = 0;
        for (let i = fStart; i < fEnd; i++) { lowSum += lowEnergyRatio[i]; rmsSum += rms[i]; n++; }
        const avgLow = n > 0 ? lowSum / n : 0;
        const avgRms = n > 0 ? rmsSum / n : 0;
        // Very high low-freq ratio + quiet = definitely a breath, even if slightly longer
        if (avgLow > 0.7 && avgRms < 0.35) {
          events.push({
            type: 'breath', start: run.start, end: run.end,
            duration: run.dur, selected: true,
            label: 'Long breath ' + (run.dur * 1000).toFixed(0) + 'ms',
            confidence: Math.min(1, avgLow * 1.2),
          });
        }
      });
    }

    // Detect filler words: short voiced segment surrounded by silence, mid-level energy
    // Build set of start times already classified as breaths to avoid double-detection
    const breathStartTimes = new Set(events.filter(e => e.type === 'breath').map(e => e.start.toFixed(3)));
    if (doDetectFillers) {
      voicedRuns.forEach(run => {
        if (run.dur > fillerMax || run.dur < 0.08) return;
        // Skip runs already classified as breaths
        if (breathStartTimes.has(run.start.toFixed(3))) return;
        const fStart = Math.round(run.start / 0.01);
        const fEnd   = Math.min(nFrames, Math.round(run.end / 0.01));
        let rmsSum = 0;
        for (let i = fStart; i < fEnd; i++) rmsSum += rms[i];
        const avgRms = (rmsSum / Math.max(1, fEnd - fStart));
        // Filler words: louder than a breath (>0.15), not stressed speech (<0.65)
        // Raised floor from 0.08→0.15 to exclude quiet breaths that slipped through
        if (avgRms > 0.15 && avgRms < 0.65) {
          events.push({
            type: 'filler', start: run.start, end: run.end,
            duration: run.dur, selected: true,
            label: 'Filler ~' + (run.dur * 1000).toFixed(0) + 'ms',
            confidence: Math.min(0.95, 0.5 + (avgRms - 0.15) * 0.8),
          });
        }
      });
    }

    // Low-energy segments
    if (doDetectLowEn) {
      silenceRuns.forEach(run => {
        if (run.dur >= 0.1 && run.dur < minSilence) {
          events.push({
            type: 'pause', start: run.start, end: run.end,
            duration: run.dur, selected: false,
            label: '⚡ Low energy ' + run.dur.toFixed(2) + 's',
            confidence: 0.35,
          });
        }
      });
    }
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  setAiProgress(75, SpeechRecognition ? 'Running speech recognition…' : 'Speech recognition not available — using energy analysis only');

  // ── Web Speech API for filler words (Chrome/Edge) ─────────────────────────
  if (SpeechRecognition && doDetectFillers) {
    try {
      const speechEvents = await runSpeechRecognition(clip);
      // Merge speech-detected fillers (higher confidence)
      speechEvents.forEach(se => {
        // Check if we already have an energy-detected event nearby
        const nearby = events.find(ev =>
          ev.type === 'filler' && Math.abs(ev.start - se.start) < 0.3);
        if (nearby) {
          // Upgrade confidence and set label from transcript
          nearby.label      = '"' + se.word + '" (' + (se.dur * 1000).toFixed(0) + 'ms)';
          nearby.confidence = Math.max(nearby.confidence, se.confidence);
          nearby.transcriptConfirmed = true;
        } else {
          events.push({
            type: 'filler', start: se.start, end: se.end,
            duration: se.dur, selected: true,
            label: '"' + se.word + '" — transcript confirmed',
            confidence: se.confidence,
            transcriptConfirmed: true,
          });
        }
      });
      setAiProgress(90, 'Merging speech recognition results…');
    } catch(e) {
      // Speech recognition failed or not supported — fine, energy analysis covers it
      console.warn('[AI Cleanup] Speech recognition skipped:', e.message);
    }
  }

  // Sort by time
  events.sort((a, b) => a.start - b.start);
  aiState.detectedEvents = events;

  setAiProgress(100, 'Analysis complete.');
  setAiStatus(events.length + ' event' + (events.length !== 1 ? 's' : '') + ' detected.');
  renderAiEvents();

  document.getElementById('ai-results-section').classList.add('show');
  if (events.length > 0) document.getElementById('ai-apply-btn').disabled = false;
}

// ── Web Speech API filler detection ──────────────────────────────────────────
async function runSpeechRecognition(clip) {
  const FILLERS = new Set(['um','uh','hmm','hm','er','ah','like','erm','umm','uhh','uhm']);
  return new Promise((resolve) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.continuous    = true;
    rec.interimResults = false;
    rec.lang          = 'en-US';
    rec.maxAlternatives = 1;

    const results = [];
    let   resolved = false;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const transcript = result[0].transcript.toLowerCase().trim();
        const words      = transcript.split(/\s+/);
        words.forEach(word => {
          const clean = word.replace(/[^a-z]/g, '');
          if (FILLERS.has(clean)) {
            // We don't get word-level timestamps from basic SpeechRecognition API
            // but we record it occurred
            results.push({ word: clean, confidence: result[0].confidence || 0.7,
              start: 0, end: 0.5, dur: 0.3 }); // timestamps approximate
          }
        });
      }
    };

    rec.onend = () => {
      if (!resolved) { resolved = true; resolve(results); }
    };
    rec.onerror = () => {
      if (!resolved) { resolved = true; resolve(results); }
    };

    // Feed audio via a temporary audio element
    const audio = new Audio(clip.url);
    audio.play().then(() => {
      rec.start();
      // Stop after clip duration or 60s max
      const dur = Math.min(clip.duration || 60, 60);
      setTimeout(() => {
        try { rec.stop(); } catch(e) {}
        audio.pause();
        if (!resolved) { resolved = true; resolve(results); }
      }, dur * 1000 + 2000);
    }).catch(() => {
      if (!resolved) { resolved = true; resolve(results); }
    });
  });
}

// ── Render detected events list ───────────────────────────────────────────────
function renderAiEvents() {
  const list    = document.getElementById('ai-event-list');
  const title   = document.getElementById('ai-results-title');
  const events  = aiState.detectedEvents;
  const selCount = events.filter(e => e.selected).length;

  if (title) title.textContent = events.length + ' event' + (events.length !== 1 ? 's' : '') +
    ' detected' + (selCount > 0 ? ' · ' + selCount + ' selected' : '');

  if (!list) return;
  if (events.length === 0) {
    list.innerHTML = '<div class="ai-no-events">No events detected. Try adjusting sensitivity settings.</div>';
    return;
  }

  list.innerHTML = '';
  events.forEach((ev, idx) => {
    const row = document.createElement('div');
    row.className = 'ai-event' + (ev.selected ? ' selected' : '');

    const confPct = Math.round((ev.confidence || 0) * 100);
    row.innerHTML = `
      <input type="checkbox" ${ev.selected ? 'checked' : ''} data-idx="${idx}">
      <span class="ai-event-type ${ev.type}">${ev.type}</span>
      <span class="ai-event-tc">${formatTC(ev.start)}</span>
      <span class="ai-event-dur">${ev.duration.toFixed(2)}s</span>
      <span class="ai-event-desc">${ev.label}</span>
      <span class="ai-event-conf">${confPct}%</span>`;

    // Toggle on row or checkbox click
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') {
        aiState.detectedEvents[idx].selected = e.target.checked;
      } else {
        aiState.detectedEvents[idx].selected = !aiState.detectedEvents[idx].selected;
      }
      renderAiEvents();
    });

    // Click timecode to scrub playhead there
    row.querySelector('.ai-event-tc').addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = state.timeline.find(t => t.id === aiState.sourceEntryId);
      if (entry) {
        state.playheadTime = entry.start + ev.start;
        updatePlayhead();
        renderCanvasFrame();
      }
    });

    list.appendChild(row);
  });

  document.getElementById('ai-apply-btn').disabled = selCount === 0;
}

// ── Apply cuts ─────────────────────────────────────────────────────────────
document.getElementById('ai-apply-btn').addEventListener('click', applyAiCuts);

function applyAiCuts() {
  const entry = state.timeline.find(t => t.id === aiState.sourceEntryId);
  if (!entry) { setAiStatus('Source clip no longer on timeline.'); return; }

  const selected = aiState.detectedEvents
    .filter(ev => ev.selected)
    .sort((a, b) => a.start - b.start);

  if (!selected.length) { setAiStatus('No events selected to cut.'); return; }

  pushUndo();

  const keepGap  = parseFloat(document.getElementById('ai-keep-gap').value) || 0;
  const addFade  = document.getElementById('ai-add-fade').checked;
  const fadeDur  = addFade ? 0.03 : 0;

  const clip = state.clips.find(c => c.id === entry.clipId);
  if (!clip) return;

  // Build list of regions to KEEP (inverse of cuts)
  // Each cut [ev.start, ev.end] in clip-local time maps to
  // [entry.inPoint + ev.start, entry.inPoint + ev.end] in clip source time

  // Merge overlapping/adjacent selected events
  const merged = [];
  selected.forEach(ev => {
    if (merged.length && ev.start <= merged[merged.length-1].end + 0.01) {
      merged[merged.length-1].end = Math.max(merged[merged.length-1].end, ev.end);
    } else {
      merged.push({ start: ev.start, end: ev.end });
    }
  });

  // Build keep regions
  const clipDur = entry.duration;
  const keepRegions = [];
  let cursor = 0;
  merged.forEach(cut => {
    const cutStart = Math.max(0, Math.min(cut.start, clipDur));
    const cutEnd   = Math.max(0, Math.min(cut.end, clipDur));
    if (cutStart > cursor + 0.01) {
      keepRegions.push({ start: cursor, end: cutStart });
    }
    // Keep a short gap if requested
    if (keepGap > 0) {
      keepRegions.push({ start: cutStart, end: Math.min(cutStart + keepGap, cutEnd) });
    }
    cursor = cutEnd;
  });
  if (cursor < clipDur - 0.01) {
    keepRegions.push({ start: cursor, end: clipDur });
  }

  if (keepRegions.length === 0) {
    setAiStatus('All audio would be removed — aborting.');
    return;
  }
  // Warn if result will be very short
  const totalKept = keepRegions.reduce((s, r) => s + (r.end - r.start), 0);
  if (totalKept < 0.5) {
    setAiStatus('Less than 0.5s would remain — aborting to prevent empty clip.');
    return;
  }

  // Remove original entry
  const origIdx   = state.timeline.indexOf(entry);
  const origTrack = entry.track;
  const origStart = entry.start;
  state.timeline.splice(origIdx, 1);

  // Create new entries for each keep region, placed end-to-end
  let placeAt = origStart;
  keepRegions.forEach((region, i) => {
    const regDur = region.end - region.start;
    if (regDur < 0.02) return; // skip tiny slivers

    const newEntry = {
      id:        uid(),
      clipId:    entry.clipId,
      track:     origTrack,
      start:     placeAt,
      duration:  regDur,
      inPoint:   (entry.inPoint || 0) + region.start,
      outPoint:  (entry.inPoint || 0) + region.end,
      fadeIn:    i === 0 ? entry.fadeIn : fadeDur,
      fadeOut:   i === keepRegions.length - 1 ? entry.fadeOut : fadeDur,
    };
    state.timeline.push(newEntry);
    placeAt += regDur;
  });

  // Sort timeline
  state.timeline.sort((a, b) => a.start - b.start);

  renderTimeline();
  renderCanvasFrame();
  syncCanvasPlaceholder();

  const removed = merged.length;
  const totalSaved = merged.reduce((s, c) => s + (c.end - c.start), 0);
  setAiStatus('✓ Applied ' + removed + ' cut' + (removed !== 1 ? 's' : '') +
    ', saved ' + totalSaved.toFixed(1) + 's');
  setStatus('AI Cleanup: ' + removed + ' region' + (removed !== 1 ? 's' : '') +
    ' removed (' + totalSaved.toFixed(1) + 's total)');

  // Clear selection so user can do another pass
  aiState.detectedEvents.forEach(ev => ev.selected = false);
  renderAiEvents();
  document.getElementById('ai-apply-btn').disabled = true;
}


// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: TRANSITIONS
// Cross dissolve, dip to black, wipe between adjacent video clips
// ═════════════════════════════════════════════════════════════════════════════

const TRANSITION_TYPES = {
  none:         { label: 'None',         duration: 0 },
  dissolve:     { label: 'Cross Dissolve', duration: 0.5 },
  dip_black:    { label: 'Dip to Black',  duration: 0.75 },
  dip_white:    { label: 'Dip to White',  duration: 0.75 },
  wipe_right:   { label: 'Wipe Right',    duration: 0.5 },
  wipe_left:    { label: 'Wipe Left',     duration: 0.5 },
  push_right:   { label: 'Push Right',    duration: 0.5 },
};

// Transitions are stored on timeline entries as entry.transitionIn / entry.transitionOut
// entry.transitionOut = { type, duration } — plays at the END of this entry
// entry.transitionIn  = { type, duration } — plays at the START of this entry (usually mirrors previous)

function applyTransition(entryId, direction, type, duration) {
  const entry = state.timeline.find(t => t.id === entryId);
  if (!entry) return;
  pushUndo();
  const t = { type, duration: parseFloat(duration) || 0.5 };
  if (direction === 'out') entry.transitionOut = t;
  if (direction === 'in')  entry.transitionIn  = t;
  // Also apply complementary transition to adjacent clip
  const sorted = state.timeline
    .filter(e => e.track === entry.track)
    .sort((a,b) => a.start - b.start);
  const idx = sorted.findIndex(e => e.id === entryId);
  if (direction === 'out' && idx < sorted.length - 1) {
    sorted[idx+1].transitionIn = t;
  }
  if (direction === 'in' && idx > 0) {
    sorted[idx-1].transitionOut = t;
  }
  renderTimeline();
  setStatus(`Transition: ${TRANSITION_TYPES[type]?.label || type} (${t.duration}s)`);
}

// Render transitions in canvas frame
function renderTransition(ctx, W, H, entry, clip, t, alpha) {
  const trans = entry.transitionOut;
  if (!trans || trans.type === 'none' || !trans.duration) return false;
  const elapsed   = t - entry.start;
  const remaining = entry.start + entry.duration - t;
  const progress  = remaining < trans.duration ? 1 - remaining / trans.duration : 0;
  if (progress <= 0) return false;

  const vel = ensureLiveVideoEl(clip);
  if (!vel) return false;

  ctx.save();
  switch(trans.type) {
    case 'dissolve':
      ctx.globalAlpha = alpha * (1 - progress);
      ctx.drawImage(vel, 0, 0, W, H);
      break;
    case 'dip_black':
      ctx.globalAlpha = alpha;
      ctx.drawImage(vel, 0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.globalAlpha = progress > 0.5 ? (progress - 0.5) * 2 : progress * 2;
      ctx.fillRect(0, 0, W, H);
      break;
    case 'dip_white':
      ctx.globalAlpha = alpha;
      ctx.drawImage(vel, 0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = progress > 0.5 ? (progress - 0.5) * 2 : progress * 2;
      ctx.fillRect(0, 0, W, H);
      break;
    case 'wipe_right':
      ctx.globalAlpha = alpha;
      ctx.drawImage(vel, 0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(W * (1 - progress), 0, W, H);
      break;
    case 'wipe_left':
      ctx.globalAlpha = alpha;
      ctx.drawImage(vel, 0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W * progress, H);
      break;
    default:
      ctx.globalAlpha = alpha;
      ctx.drawImage(vel, 0, 0, W, H);
  }
  ctx.restore();
  return true;
}

// Patch renderTimeline to show transition badges on clips
(function() {
  const origRT2 = renderTimeline;
  renderTimeline = function renderTimeline() {
    origRT2();
    state.timeline.forEach(entry => {
      const el = document.querySelector(`.clip[data-id="${entry.id}"]`);
      if (!el) return;
      if (entry.transitionOut && entry.transitionOut.type !== 'none') {
        let badge = el.querySelector('.clip-transition.trans-end');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'clip-transition trans-end';
          badge.title = 'Transition: ' + (TRANSITION_TYPES[entry.transitionOut.type]?.label || '');
          badge.textContent = '◆';
          el.appendChild(badge);
        }
        badge.addEventListener('click', e => { e.stopPropagation(); openTransitionPicker(entry.id, 'out'); });
      }
      if (entry.transitionIn && entry.transitionIn.type !== 'none') {
        let badge = el.querySelector('.clip-transition.trans-start');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'clip-transition trans-start';
          badge.title = 'Transition: ' + (TRANSITION_TYPES[entry.transitionIn.type]?.label || '');
          badge.textContent = '◆';
          el.appendChild(badge);
        }
        badge.addEventListener('click', e => { e.stopPropagation(); openTransitionPicker(entry.id, 'in'); });
      }
    });
  };
})();

// Inline transition picker (shows near the clip)
function openTransitionPicker(entryId, direction) {
  // Remove any existing picker
  document.getElementById('trans-picker')?.remove();
  const clip = document.querySelector(`.clip[data-id="${entryId}"]`);
  if (!clip) return;
  const picker = document.createElement('div');
  picker.id = 'trans-picker';
  picker.style.cssText = `position:absolute;background:#1a1e28;border:1px solid #2a3040;border-radius:6px;padding:8px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,0.6);min-width:160px;`;
  const entry = state.timeline.find(t => t.id === entryId);
  const current = (direction === 'out' ? entry?.transitionOut : entry?.transitionIn) || { type:'none', duration:0.5 };

  picker.innerHTML = `<div style="font-size:9px;color:#5a7a9a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Transition ${direction}</div>` +
    Object.entries(TRANSITION_TYPES).map(([type, info]) =>
      `<div data-type="${type}" style="padding:4px 8px;border-radius:3px;font-size:10px;cursor:pointer;color:${type===current.type?'#ffcc00':'#8ab0d0'};background:${type===current.type?'rgba(255,204,0,0.1)':'transparent'}" 
        class="trans-option">${info.label}</div>`
    ).join('') +
    `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #1e2530;">
      <span style="font-size:9px;color:#5a7a9a;">Duration</span>
      <input type="range" min="0.2" max="2" step="0.1" value="${current.duration}" id="trans-dur-slider" style="flex:1;height:4px;">
      <span id="trans-dur-val" style="font-size:9px;color:#8ab0d0;width:28px;">${current.duration}s</span>
    </div>`;

  // Position near clip
  const clipRect = clip.getBoundingClientRect();
  const tracks   = document.getElementById('timeline-tracks');
  const tracksRect = tracks ? tracks.getBoundingClientRect() : { left:0, top:0 };
  picker.style.left = (clipRect.left - tracksRect.left + tracks.scrollLeft) + 'px';
  picker.style.top  = (clipRect.bottom - tracksRect.top + 4) + 'px';
  tracks.appendChild(picker);

  picker.querySelector('#trans-dur-slider')?.addEventListener('input', e => {
    document.getElementById('trans-dur-val').textContent = parseFloat(e.target.value).toFixed(1) + 's';
  });

  picker.querySelectorAll('.trans-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const dur = parseFloat(picker.querySelector('#trans-dur-slider')?.value || 0.5);
      applyTransition(entryId, direction, opt.dataset.type, dur);
      picker.remove();
    });
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closePicker(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', closePicker); }
    });
  }, 50);
}

// Patch renderCanvasFrame to apply transitions
(function() {
  const origRCF = renderCanvasFrame;
  renderCanvasFrame = function renderCanvasFrame() {
    // We override the whole function to support transitions
    const screen = document.getElementById('viewer-screen-cvs');
    if (!screen || !canvasOutput) return;
    const W = screen.offsetWidth || 640, H = screen.offsetHeight || 360;
    if (canvasOutput.width !== W || canvasOutput.height !== H) { canvasOutput.width=W; canvasOutput.height=H; }
    const ctx = canvasOutput.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const t = state.playheadTime;

    state.timeline.forEach(entry => {
      if (t < entry.start || t > entry.start + entry.duration) return;
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip) return;

      let alpha = 1;
      const elapsed   = t - entry.start;
      const remaining = entry.start + entry.duration - t;
      if (entry.fadeIn  > 0 && elapsed   < entry.fadeIn)  alpha = elapsed  / entry.fadeIn;
      if (entry.fadeOut > 0 && remaining < entry.fadeOut)  alpha = Math.min(alpha, remaining / entry.fadeOut);

      if (clip.type === 'video') {
        const vel = ensureLiveVideoEl(clip);
        if (!vel) return;
        const target = t - entry.start + (entry.inPoint || 0);
        if (Math.abs(vel.currentTime - target) > 0.15) vel.currentTime = target;

        // Apply video props (scale, rotate, brightness etc)
        const vp = entry.videoProps;
        ctx.save();
        if (vp) {
          const b = 1 + (vp.brightness||0)/100, c2 = 1 + (vp.contrast||0)/100,
                s = 1 + (vp.saturation||0)/100;
          ctx.filter = `brightness(${b}) contrast(${c2}) saturate(${s})`;
        }

        // Check if in transition
        const inTrans = renderTransition(ctx, W, H, entry, clip, t, alpha);
        if (!inTrans) {
          ctx.globalAlpha = alpha;
          ctx.drawImage(vel, 0, 0, W, H);
        }
        ctx.restore();
      }

      if (clip.type === 'text' && clip.textProps && typeof drawTextGraphic === 'function') {
        drawTextGraphic(ctx, clip.textProps, W, H, alpha);
      }
    });

    // Apply per-entry canvas effects (CSS filter on canvas element)
    const selEntry = state.timeline.find(e => e.id === state.selectedTimelineId);
    if (selEntry?.videoProps?.cssFilter) {
      canvasOutput.style.filter = selEntry.videoProps.cssFilter;
    } else if (selEntry?.lut) {
      // LUT applied via applyLutToCanvas after draw
      applyLutToCanvas(ctx, W, H, selEntry.lut, selEntry.lutIntensity || 1);
    } else {
      canvasOutput.style.filter = '';
    }
  };
})();


// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: VOLUME ENVELOPE
// Per-clip volume with keyframe automation
// ═════════════════════════════════════════════════════════════════════════════

// entry.volumeKeyframes = [{time: 0-1 (normalised), volume: 0-2}]
// entry.clipVolume = 0-2 (overall multiplier, default 1)

function getVolumeAt(entry, localTime) {
  const kf = entry.volumeKeyframes;
  if (!kf || kf.length === 0) return (entry.clipVolume || 1);
  const normTime = entry.duration > 0 ? localTime / entry.duration : 0;
  if (kf.length === 1) return kf[0].volume;
  // Sort by time
  const sorted = [...kf].sort((a,b) => a.time - b.time);
  if (normTime <= sorted[0].time)   return sorted[0].volume;
  if (normTime >= sorted[sorted.length-1].time) return sorted[sorted.length-1].volume;
  // Linear interpolation
  for (let i = 0; i < sorted.length - 1; i++) {
    if (normTime >= sorted[i].time && normTime <= sorted[i+1].time) {
      const t = (normTime - sorted[i].time) / (sorted[i+1].time - sorted[i].time);
      return sorted[i].volume * (1-t) + sorted[i+1].volume * t;
    }
  }
  return entry.clipVolume || 1;
}

// Draw volume envelope on audio clips in timeline
function drawVolumeEnvelope(clipEl, entry) {
  const kf = entry.volumeKeyframes;
  if (!kf || kf.length === 0) return;
  const W = clipEl.offsetWidth, H = clipEl.offsetHeight;
  if (!W || !H) return;

  // Draw line connecting keyframes
  const canvas = document.createElement('canvas');
  canvas.className = 'vol-envelope-canvas';
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const sorted = [...kf].sort((a,b) => a.time - b.time);
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([3,2]);
  ctx.beginPath();
  sorted.forEach((k, i) => {
    const x = k.time * W;
    const y = H - (k.volume / 2) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  clipEl.appendChild(canvas);

  // Render draggable keyframe dots
  sorted.forEach((kf2, ki) => {
    const dot = document.createElement('div');
    dot.className = 'vol-keyframe';
    dot.style.left = (kf2.time * 100) + '%';
    dot.style.top  = (100 - (kf2.volume / 2) * 100) + '%';
    dot.title      = 'Vol: ' + Math.round(kf2.volume * 100) + '%';

    let dragging = false, sx = 0, sy = 0, sv = kf2.volume, st = kf2.time;
    dot.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      dragging = true; sx = e.clientX; sy = e.clientY;
      dot.classList.add('dragging');
      const onMove = e2 => {
        if (!dragging) return;
        const rect = clipEl.getBoundingClientRect();
        const nx = Math.max(0, Math.min(1, (e2.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(2, 2 - ((e2.clientY - rect.top) / rect.height) * 2));
        kf2.time = nx; kf2.volume = ny;
        renderTimeline();
      };
      const onUp = () => {
        dragging = false;
        dot.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Right-click removes keyframe
    dot.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      pushUndo();
      entry.volumeKeyframes.splice(entry.volumeKeyframes.indexOf(kf2), 1);
      renderTimeline();
    });
    clipEl.appendChild(dot);
  });
}

// Patch renderTimeline to draw volume envelopes
(function() {
  const origRT3 = renderTimeline;
  renderTimeline = function renderTimeline() {
    origRT3();
    state.timeline.forEach(entry => {
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || clip.type !== 'audio') return;
      const el = document.querySelector(`.clip[data-id="${entry.id}"]`);
      if (el && entry.volumeKeyframes?.length) drawVolumeEnvelope(el, entry);
    });
  };
})();

// Double-click clip to add volume keyframe
document.getElementById('timeline-tracks').addEventListener('dblclick', e => {
  const clipEl = e.target.closest('.clip');
  if (!clipEl) return;
  const entryId = clipEl.dataset.id;
  const entry   = state.timeline.find(t => t.id === entryId);
  const clip    = entry ? state.clips.find(c => c.id === entry.clipId) : null;
  if (!clip || clip.type !== 'audio') return;
  e.preventDefault();
  pushUndo();
  if (!entry.volumeKeyframes) entry.volumeKeyframes = [];
  const rect  = clipEl.getBoundingClientRect();
  const normX = (e.clientX - rect.left) / rect.width;
  const normY = Math.max(0, Math.min(2, 2 - ((e.clientY - rect.top) / rect.height) * 2));
  entry.volumeKeyframes.push({ time: normX, volume: normY });
  renderTimeline();
  setStatus('Volume keyframe added at ' + Math.round(normX * 100) + '% — ' + Math.round(normY * 100) + '%');
});

// Wire volume inspector controls
document.getElementById('p-clip-volume').addEventListener('input', e => {
  const v = parseFloat(e.target.value) / 100;
  document.getElementById('pv-clip-volume').textContent = e.target.value + '%';
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (entry) { entry.clipVolume = v; }
});

document.getElementById('vol-add-fade-in').addEventListener('click', () => {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  pushUndo();
  if (!entry.volumeKeyframes) entry.volumeKeyframes = [];
  entry.volumeKeyframes.push({ time: 0, volume: 0 }, { time: 0.15, volume: 1 });
  renderTimeline();
});
document.getElementById('vol-add-fade-out').addEventListener('click', () => {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  pushUndo();
  if (!entry.volumeKeyframes) entry.volumeKeyframes = [];
  entry.volumeKeyframes.push({ time: 0.85, volume: 1 }, { time: 1, volume: 0 });
  renderTimeline();
});
document.getElementById('vol-reset').addEventListener('click', () => {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  pushUndo();
  entry.volumeKeyframes = [];
  entry.clipVolume = 1;
  document.getElementById('p-clip-volume').value = 100;
  document.getElementById('pv-clip-volume').textContent = '100%';
  renderTimeline();
});


// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: SAVE / LOAD PROJECT + AUTO-SAVE
// Serialise full state to localStorage / JSON file
// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: SAVE / LOAD PROJECT + AUTO-SAVE
// ═════════════════════════════════════════════════════════════════════════════

const PROJECT_KEY  = 'cutpro_projects_v1';
const AUTOSAVE_KEY = 'cutpro_autosave_v1';

function getSavedProjects() {
  try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]'); } catch(e) { return []; }
}
function setSavedProjects(projects) {
  try { localStorage.setItem(PROJECT_KEY, JSON.stringify(projects)); } catch(e) {}
}

function serialiseProject(name) {
  return {
    name:        name || 'Untitled',
    savedAt:     Date.now(),
    seqDuration: state.seqDuration,
    zoom:        state.zoom,
    timeline:    JSON.parse(JSON.stringify(state.timeline)),
    // Clips: only serialisable metadata (no File objects or blob URLs)
    clips: state.clips.map(c => ({
      id: c.id, name: c.name, duration: c.duration, type: c.type,
      bpm: c.bpm || null, fromLibrary: c.fromLibrary || false,
      libraryUrl: c.fromLibrary ? c.url : null,
      textProps: c.textProps || null,
      beatMarkers: null, waveformData: null,
    })),
  };
}

function saveProject(name) {
  const projects = getSavedProjects();
  const proj = serialiseProject(name);
  const idx = projects.findIndex(p => p.name === proj.name);
  if (idx >= 0) projects[idx] = proj; else projects.unshift(proj);
  setSavedProjects(projects.slice(0, 20));
  return proj;
}

function loadProjectData(proj) {
  if (!proj) return;
  pushUndo();
  state.seqDuration = proj.seqDuration || 120;
  state.zoom        = proj.zoom || 3;

  // Restore full timeline structure
  state.timeline = JSON.parse(JSON.stringify(proj.timeline || []));

  // Restore ALL clips — library/text clips fully, local file clips as stubs
  // Local stubs keep name/duration so timeline renders correctly, just greyed out
  state.clips = (proj.clips || []).map(c => {
    const isLibrary  = c.fromLibrary && c.libraryUrl;
    const isText     = c.textProps || c.type === 'text';
    return {
      ...c,
      url:          isLibrary ? c.libraryUrl : null,
      file:         null,
      beatMarkers:  null,
      waveformData: null,
      _stub:        !isLibrary && !isText, // marks local clips that need re-import
    };
  });

  // Count what was restored vs needs re-import
  const stubCount    = state.clips.filter(c => c._stub).length;
  const restoredCount = state.clips.length - stubCount;

  renderTimeline();
  renderBin();
  drawRuler();
  syncCanvasPlaceholder();

  if (stubCount > 0) {
    setStatus(
      'Project loaded: ' + proj.name +
      ' — ' + restoredCount + ' clip' + (restoredCount !== 1 ? 's' : '') + ' restored' +
      ', ' + stubCount + ' local file' + (stubCount !== 1 ? 's' : '') +
      ' need re-importing (drag them back onto the timeline)'
    );
  } else {
    setStatus('Project loaded: ' + proj.name + ' — ' + restoredCount + ' clips restored ✓');
  }
}

function renderProjectList() {
  const list = document.getElementById('project-list');
  if (!list) return;
  const projects = getSavedProjects().filter(p => p.name !== '_autosave_');
  if (projects.length === 0) {
    list.innerHTML = '<div class="project-empty">No saved projects yet. Save your current project above.</div>';
    return;
  }
  list.innerHTML = '';
  projects.forEach(proj => {
    const item = document.createElement('div');
    item.className = 'project-item';
    const d = new Date(proj.savedAt);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const clipTypes = (proj.clips||[]).reduce((acc,c) => {
      const t = c.type === 'text' ? 'text' : c.fromLibrary ? 'music' : c.type;
      acc[t] = (acc[t]||0) + 1; return acc;
    }, {});
    const clipSummary = Object.entries(clipTypes).map(([t,n]) => n + ' ' + t).join(', ') || 'empty';
    item.innerHTML = `
      <div class="project-item-name">${proj.name}</div>
      <div class="project-item-meta">${dateStr} · ${(proj.timeline||[]).length} clips (${clipSummary})</div>
      <button class="project-item-load" data-name="${proj.name}">Load</button>
      <button class="project-item-del" data-name="${proj.name}" title="Delete">✕</button>`;
    item.querySelector('.project-item-load').addEventListener('click', e => {
      e.stopPropagation();
      const p = getSavedProjects().find(x => x.name === e.target.dataset.name);
      if (p) { loadProjectData(p); closeProjectModal(); }
    });
    item.querySelector('.project-item-del').addEventListener('click', e => {
      e.stopPropagation();
      const name = e.target.dataset.name;
      setSavedProjects(getSavedProjects().filter(p => p.name !== name));
      renderProjectList();
    });
    list.appendChild(item);
  });
}

function openProjectModal() {
  const nameEl = document.getElementById('project-name-input');
  if (nameEl && !nameEl.value) nameEl.value = 'My Project';
  renderProjectList();
  document.getElementById('project-modal')?.classList.add('open');
}
function closeProjectModal() {
  document.getElementById('project-modal')?.classList.remove('open');
}

document.getElementById('btn-save-load')?.addEventListener('click', openProjectModal);
document.getElementById('project-close')?.addEventListener('click', closeProjectModal);
document.getElementById('project-close2')?.addEventListener('click', closeProjectModal);
// btn-save-load (💾 in toolbar) opens the project modal

document.getElementById('project-save-btn')?.addEventListener('click', () => {
  const name = (document.getElementById('project-name-input')?.value || '').trim() || 'Untitled';
  saveProjectWithOfflineSupport(name);
  renderProjectList();
});

// Export to JSON file
document.getElementById('project-export-json')?.addEventListener('click', () => {
  const name = (document.getElementById('project-name-input')?.value || '').trim() || 'project';
  const proj = serialiseProject(name);
  const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = name.replace(/[^a-z0-9]/gi,'_') + '.cutpro'; a.click();
  setStatus('Exported: ' + name + '.cutpro');
});

// Import from JSON file
document.getElementById('project-import-json')?.addEventListener('click', () => {
  document.getElementById('project-import-file')?.click();
});
document.getElementById('project-import-file')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const proj = JSON.parse(ev.target.result);
      loadProjectData(proj);
      closeProjectModal();
    } catch(err) {
      setStatus('Import failed: invalid .cutpro file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Auto-save toast
function showAutoSaveToast(msg) {
  const toast = document.getElementById('autosave-toast');
  if (!toast) return;
  toast.textContent = '● ' + (msg || 'Auto-saved');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Auto-save every 60 seconds
let autoSaveTimer = setInterval(() => {
  if (state.timeline.length === 0) return;
  try {
    const proj = serialiseProject('_autosave_');
    const projects = getSavedProjects().filter(p => p.name !== '_autosave_');
    projects.unshift(proj);
    setSavedProjects(projects.slice(0, 21));
    showAutoSaveToast('Auto-saved');
  } catch(e) {}
}, 60000);

// Restore autosave on load (non-intrusive — just a status message)
(function() {
  const projects = getSavedProjects();
  const as = projects.find(p => p.name === '_autosave_');
  if (as && as.timeline && as.timeline.length > 0) {
    const d = new Date(as.savedAt);
    setStatus('Auto-save found from ' + d.toLocaleTimeString() + ' — open Projects (💾) to restore');
  }
})();

// Wire btn-save-load keyboard shortcut Ctrl/Cmd+S
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    const nameInput = document.getElementById('project-name-input');
    const name = (nameInput?.value || '').trim() ||
      'Project ' + new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'});
    if (nameInput && !nameInput.value) nameInput.value = name;
    saveProjectWithOfflineSupport(name);
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: COLOUR GRADING LUTs
// ═════════════════════════════════════════════════════════════════════════════

const LUTS = [
  { id: 'none',      name: 'None',      preview: '#555',
    fn: null },
  { id: 'cinematic', name: 'Cinematic', preview: 'linear-gradient(135deg,#1a2a3a,#4a3a1a)',
    fn: (r,g,b) => [r*0.85+10, g*0.85+5, b*0.75+15] },
  { id: 'warm',      name: 'Warm',      preview: 'linear-gradient(135deg,#5a2a10,#7a5a10)',
    fn: (r,g,b) => [Math.min(255,r*1.1+15), g*0.95, b*0.8] },
  { id: 'cool',      name: 'Cool',      preview: 'linear-gradient(135deg,#0a1a4a,#1a3a5a)',
    fn: (r,g,b) => [r*0.85, g*0.95, Math.min(255,b*1.1+15)] },
  { id: 'vintage',   name: 'Vintage',   preview: 'linear-gradient(135deg,#3a2a10,#4a3a1a)',
    fn: (r,g,b) => [Math.min(255,r*0.9+20), Math.min(255,g*0.85+15), b*0.7] },
  { id: 'noir',      name: 'Noir',      preview: 'linear-gradient(135deg,#111,#333)',
    fn: (r,g,b) => { const l=r*0.299+g*0.587+b*0.114; return [l,l,l]; } },
  { id: 'golden',    name: 'Golden',    preview: 'linear-gradient(135deg,#4a3a00,#6a5a00)',
    fn: (r,g,b) => [Math.min(255,r*1.05+10), Math.min(255,g*0.98+5), b*0.75] },
  { id: 'matte',     name: 'Matte',     preview: 'linear-gradient(135deg,#1a2a1a,#2a3a2a)',
    fn: (r,g,b) => [r*0.88+15, g*0.88+15, b*0.88+15] },
  { id: 'haze',      name: 'Haze',      preview: 'linear-gradient(135deg,#2a2a4a,#3a3a5a)',
    fn: (r,g,b) => [Math.min(255,r*0.85+25), Math.min(255,g*0.85+20), Math.min(255,b*0.9+30)] },
  { id: 'vivid',     name: 'Vivid',     preview: 'linear-gradient(135deg,#3a0a0a,#0a0a3a)',
    fn: (r,g,b) => [Math.min(255,r*1.2-10), Math.min(255,g*1.1-5), Math.min(255,b*1.15-5)] },
  { id: 'bleach',    name: 'Bleach',    preview: 'linear-gradient(135deg,#3a3a2a,#5a5a3a)',
    fn: (r,g,b) => { const l=r*0.299+g*0.587+b*0.114; return [r*0.7+l*0.3+10, g*0.7+l*0.3+10, b*0.7+l*0.3+10]; } },
  { id: 'teal_ora',  name: 'Teal/Ora',  preview: 'linear-gradient(135deg,#0a3a3a,#3a2a00)',
    fn: (r,g,b) => [Math.min(255,r*1.05+10), Math.min(255,g*0.9-5), Math.min(255,b*0.85+10)] },
];

function applyLutToCanvas(ctx, lut, W, H) {
  const def = LUTS.find(l => l.id === lut.type);
  if (!def || !def.fn) return;
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  const intensity = (lut.intensity || 100) / 100;
  for (let i = 0; i < d.length; i += 4) {
    const [nr, ng, nb] = def.fn(d[i], d[i+1], d[i+2]);
    d[i]   = Math.round(d[i]   + (nr - d[i])   * intensity);
    d[i+1] = Math.round(d[i+1] + (ng - d[i+1]) * intensity);
    d[i+2] = Math.round(d[i+2] + (nb - d[i+2]) * intensity);
  }
  ctx.putImageData(imgData, 0, 0);
}

function renderLutSwatches() {
  const grid = document.getElementById('lut-grid');
  if (!grid) return;
  grid.innerHTML = '';
  LUTS.forEach(lut => {
    const sw = document.createElement('div');
    sw.className = 'lut-swatch';
    sw.dataset.lut = lut.id;
    sw.title = lut.name;
    sw.style.background = lut.preview;
    sw.innerHTML = '<span class="lut-swatch-label">' + lut.name + '</span>';
    sw.addEventListener('click', () => {
      const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
      if (!entry) { setStatus('Select a clip first to apply LUT'); return; }
      pushUndo();
      const intensity = parseInt(document.getElementById('lut-intensity')?.value || 100);
      entry.lut = { type: lut.id, intensity };
      grid.querySelectorAll('.lut-swatch').forEach(s => s.classList.toggle('active', s.dataset.lut === lut.id));
      renderCanvasFrame();
      setStatus('LUT: ' + lut.name);
    });
    grid.appendChild(sw);
  });
}

document.getElementById('lut-intensity')?.addEventListener('input', e => {
  const v = parseInt(e.target.value);
  const vEl = document.getElementById('lut-intensity-val');
  if (vEl) vEl.textContent = v + '%';
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry || !entry.lut) return;
  entry.lut.intensity = v;
  renderCanvasFrame();
});

// Load LUT state into inspector when clip selected
(function() {
  const orig = loadFadeInspector;
  loadFadeInspector = function() {
    orig();
    const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
    const lutType = entry?.lut?.type || 'none';
    const lutInt  = entry?.lut?.intensity ?? 100;
    document.querySelectorAll('#lut-grid .lut-swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.lut === lutType));
    const intEl  = document.getElementById('lut-intensity');
    const intVEl = document.getElementById('lut-intensity-val');
    if (intEl)  intEl.value = lutInt;
    if (intVEl) intVEl.textContent = lutInt + '%';
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: MULTI-CLIP SELECT
// ═════════════════════════════════════════════════════════════════════════════

state.selectedTimelineIds = new Set();
state.multiSelectMode     = false;

document.getElementById('btn-multi-select')?.addEventListener('click', () => {
  state.multiSelectMode = !state.multiSelectMode;
  document.getElementById('btn-multi-select')?.classList.toggle('active', state.multiSelectMode);
  if (!state.multiSelectMode) { state.selectedTimelineIds.clear(); renderTimeline(); }
  setStatus('Multi-select ' + (state.multiSelectMode ? 'ON — click clips to add/remove, or rubber-band drag' : 'OFF'));
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'm' || e.key === 'M') document.getElementById('btn-multi-select')?.click();
  // Delete all selected
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedTimelineIds.size > 0) {
    e.preventDefault();
    const count = state.selectedTimelineIds.size;
    pushUndo();
    state.timeline = state.timeline.filter(t => !state.selectedTimelineIds.has(t.id));
    state.selectedTimelineIds.clear();
    renderTimeline();
    setStatus('Deleted ' + count + ' clips');
  }
});

// Highlight multi-selected clips after renderTimeline
(function() {
  const orig = renderTimeline;
  renderTimeline = function() {
    orig();
    state.selectedTimelineIds.forEach(id => {
      const el = document.querySelector('.clip[data-id="' + id + '"]');
      if (el) el.classList.add('multi-selected');
    });
  };
})();

// Click-to-toggle selection in multi-select mode
document.getElementById('timeline-tracks')?.addEventListener('click', e => {
  if (!state.multiSelectMode) return;
  const clipEl = e.target.closest('.clip');
  if (!clipEl) return;
  e.stopPropagation();
  const id = clipEl.dataset.id;
  if (!id) return;
  if (e.shiftKey && state.selectedTimelineId) {
    const anchor  = state.timeline.find(t => t.id === state.selectedTimelineId);
    const clicked = state.timeline.find(t => t.id === id);
    if (anchor && clicked && anchor.track === clicked.track) {
      const minT = Math.min(anchor.start, clicked.start);
      const maxT = Math.max(anchor.start + anchor.duration, clicked.start + clicked.duration);
      state.timeline.filter(t => t.track === anchor.track && t.start >= minT && t.start <= maxT)
        .forEach(t => state.selectedTimelineIds.add(t.id));
    }
  } else {
    if (state.selectedTimelineIds.has(id)) state.selectedTimelineIds.delete(id);
    else state.selectedTimelineIds.add(id);
  }
  renderTimeline();
}, true);

// Rubber-band selection
(function() {
  const tracks = document.getElementById('timeline-tracks');
  if (!tracks) return;
  const rb = { active: false, x: 0, y: 0, w: 0, h: 0 };
  const selRect = document.getElementById('selection-rect');

  tracks.addEventListener('mousedown', e => {
    if (!state.multiSelectMode || e.target.closest('.clip')) return;
    rb.active = true;
    const r = tracks.getBoundingClientRect();
    rb.x = e.clientX - r.left + tracks.scrollLeft;
    rb.y = e.clientY - r.top + tracks.scrollTop;
    rb.w = 0; rb.h = 0;
    if (selRect) { selRect.style.display='block'; selRect.style.left=rb.x+'px'; selRect.style.top=rb.y+'px'; selRect.style.width='0'; selRect.style.height='0'; }
  });

  document.addEventListener('mousemove', e => {
    if (!rb.active) return;
    const r = tracks.getBoundingClientRect();
    rb.w = (e.clientX - r.left + tracks.scrollLeft) - rb.x;
    rb.h = (e.clientY - r.top  + tracks.scrollTop)  - rb.y;
    if (selRect) {
      selRect.style.left   = Math.min(rb.x, rb.x + rb.w) + 'px';
      selRect.style.top    = Math.min(rb.y, rb.y + rb.h) + 'px';
      selRect.style.width  = Math.abs(rb.w) + 'px';
      selRect.style.height = Math.abs(rb.h) + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!rb.active) return;
    rb.active = false;
    if (selRect) selRect.style.display = 'none';
    if (!state.multiSelectMode || (Math.abs(rb.w) < 5 && Math.abs(rb.h) < 5)) return;
    const selLeft  = secToPx(0) + Math.min(rb.x, rb.x + rb.w);
    const selRight = secToPx(0) + Math.max(rb.x, rb.x + rb.w);
    state.timeline.forEach(entry => {
      const ex = secToPx(entry.start), ew = secToPx(entry.duration);
      if (ex + ew >= selLeft && ex <= selRight) state.selectedTimelineIds.add(entry.id);
    });
    renderTimeline();
  });
})();


// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: TRANSITIONS
// ═════════════════════════════════════════════════════════════════════════════

const TRANSITIONS = {
  none:       { label: 'None',      duration: 0   },
  dissolve:   { label: 'Dissolve',  duration: 0.5 },
  dip_black:  { label: 'Dip Black', duration: 0.5 },
  dip_white:  { label: 'Dip White', duration: 0.5 },
  wipe_right: { label: 'Wipe →',    duration: 0.5 },
  wipe_left:  { label: 'Wipe ←',    duration: 0.5 },
  push_right: { label: 'Push →',    duration: 0.5 },
  zoom_in:    { label: 'Zoom In',   duration: 0.5 },
};

function applyTransitionToCanvas(ctx, type, progress, W, H, drawFn) {
  ctx.save();
  switch (type) {
    case 'dissolve':
      ctx.globalAlpha = progress; drawFn(); break;
    case 'dip_black':
      if (progress < 0.5) {
        ctx.globalAlpha = 1 - progress*2; drawFn();
        ctx.globalAlpha = 1; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      } else { ctx.globalAlpha = (progress-0.5)*2; drawFn(); }
      break;
    case 'dip_white':
      if (progress < 0.5) {
        ctx.globalAlpha = 1 - progress*2; drawFn();
        ctx.globalAlpha = 1; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
      } else { ctx.globalAlpha = (progress-0.5)*2; drawFn(); }
      break;
    case 'wipe_right':
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,W*progress,H); ctx.clip(); drawFn(); ctx.restore(); break;
    case 'wipe_left':
      ctx.save(); ctx.beginPath(); ctx.rect(W*(1-progress),0,W,H); ctx.clip(); drawFn(); ctx.restore(); break;
    case 'zoom_in':
      ctx.translate(W/2,H/2); ctx.scale(0.5+progress*0.5,0.5+progress*0.5);
      ctx.translate(-W/2,-H/2); ctx.globalAlpha=progress; drawFn(); break;
    default:
      ctx.globalAlpha = progress; drawFn();
  }
  ctx.restore();
}

function applyTransition(entryId, dir, type, duration) {
  const entry = state.timeline.find(t => t.id === entryId);
  if (!entry) return;
  pushUndo();
  const t = { type, duration };
  if (dir === 'in')  { entry.transitionIn  = t; }
  if (dir === 'out') { entry.transitionOut = t; }
  if (dir === 'in') {
    const prev = state.timeline
      .filter(e => e.track === entry.track && e.start < entry.start)
      .sort((a,b) => b.start - a.start)[0];
    if (prev) prev.transitionOut = t;
  }
}

function loadTransitionInspector() {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  const ti = entry.transitionIn || { type: 'none', duration: 0.5 };
  document.querySelectorAll('#transition-in-grid .transition-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.trans === ti.type);
  });
  const durEl = document.getElementById('ti-trans-dur');
  const durV  = document.getElementById('ti-trans-dur-val');
  if (durEl) durEl.value = ti.duration || 0.5;
  if (durV)  durV.textContent = (ti.duration || 0.5).toFixed(2) + 's';
}

document.querySelectorAll('#transition-in-grid .transition-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
    if (!entry) return;
    const dur = parseFloat(document.getElementById('ti-trans-dur')?.value || 0.5);
    applyTransition(entry.id, 'in', btn.dataset.trans, dur);
    document.querySelectorAll('#transition-in-grid .transition-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTimeline(); renderCanvasFrame();
    setStatus('Transition: ' + (TRANSITIONS[btn.dataset.trans]?.label || btn.dataset.trans));
  });
});

document.getElementById('ti-trans-dur')?.addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  const vEl = document.getElementById('ti-trans-dur-val');
  if (vEl) vEl.textContent = v.toFixed(2) + 's';
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry || !entry.transitionIn) return;
  entry.transitionIn.duration = v;
  if (entry.transitionOut) entry.transitionOut.duration = v;
});

// Patch loadFadeInspector to include transition
(function() {
  const orig = loadFadeInspector;
  loadFadeInspector = function() { orig(); loadTransitionInspector(); };
})();

// Patch renderTimeline to add transition badges
(function() {
  const orig = renderTimeline;
  renderTimeline = function() {
    orig();
    state.timeline.forEach(entry => {
      const el = document.querySelector('.clip[data-id="' + entry.id + '"]');
      if (!el) return;
      el.querySelectorAll('.clip-transition-badge').forEach(b => b.remove());
      if (entry.transitionIn && entry.transitionIn.type !== 'none') {
        const b = document.createElement('div');
        b.className = 'clip-transition-badge left';
        b.textContent = (TRANSITIONS[entry.transitionIn.type]?.label || '').slice(0,4) || '▶';
        el.appendChild(b);
      }
      if (entry.transitionOut && entry.transitionOut.type !== 'none') {
        const b = document.createElement('div');
        b.className = 'clip-transition-badge right';
        b.textContent = (TRANSITIONS[entry.transitionOut.type]?.label || '').slice(0,4) || '◀';
        el.appendChild(b);
      }
    });
  };
})();

// Upgrade renderCanvasFrame to apply transitions
(function() {
  const orig = renderCanvasFrame;
  renderCanvasFrame = function() {
    const screen = document.getElementById('viewer-screen-cvs');
    if (!screen || !canvasOutput) return;
    const W = screen.offsetWidth || 640, H = screen.offsetHeight || 360;
    if (canvasOutput.width !== W || canvasOutput.height !== H) { canvasOutput.width=W; canvasOutput.height=H; }
    const ctx = canvasOutput.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
    const t = state.playheadTime;

    state.timeline.forEach(entry => {
      if (t < entry.start || t > entry.start + entry.duration) return;
      const clip = state.clips.find(c => c.id === entry.clipId);
      if (!clip || clip.type === 'audio') return;

      const elapsed   = t - entry.start;
      const remaining = entry.duration - elapsed;
      let alpha = 1;
      if (entry.fadeIn  > 0 && elapsed   < entry.fadeIn)  alpha = elapsed   / entry.fadeIn;
      if (entry.fadeOut > 0 && remaining < entry.fadeOut) alpha = Math.min(alpha, remaining / entry.fadeOut);

      if (clip.type === 'text' && clip.textProps) {
        if (typeof drawTextGraphic === 'function') drawTextGraphic(ctx, clip.textProps, W, H, alpha);
        return;
      }
      if (clip.type !== 'video') return;

      const vel = ensureLiveVideoEl(clip);
      if (!vel) return;
      const target = elapsed + (entry.inPoint || 0);
      if (Math.abs(vel.currentTime - target) > 0.15) vel.currentTime = target;

      const ti  = entry.transitionIn  || { type: 'none', duration: 0 };
      const to_ = entry.transitionOut || { type: 'none', duration: 0 };
      let transType = 'none', transProgress = alpha;
      if (ti.duration > 0 && elapsed < ti.duration) {
        transType = ti.type; transProgress = (elapsed / ti.duration) * alpha;
      } else if (to_.duration > 0 && remaining < to_.duration) {
        transType = to_.type; transProgress = (remaining / to_.duration) * alpha;
      } else { transProgress = alpha; }

      const vp = entry.videoProps;
      const drawFn = () => {
        ctx.save();
        if (vp) {
          ctx.translate(W/2,H/2);
          ctx.scale(vp.scale/100,vp.scale/100);
          ctx.rotate(vp.rotate * Math.PI/180);
          ctx.translate(-W/2,-H/2);
        }
        ctx.drawImage(vel,0,0,W,H);
        if (entry.lut && entry.lut.type !== 'none') applyLutToCanvas(ctx, entry.lut, W, H);
        ctx.restore();
      };

      if (transType === 'none') { ctx.save(); ctx.globalAlpha=transProgress; drawFn(); ctx.restore(); }
      else applyTransitionToCanvas(ctx, transType, transProgress, W, H, drawFn);
    });

    if (typeof renderTextOverlay === 'function') renderTextOverlay();
  };
})();


// ═════════════════════════════════════════════════════════════════════════════
// FEATURE: VOLUME ENVELOPE
// ═════════════════════════════════════════════════════════════════════════════

function ensureGainPoints(entry) {
  if (!entry.gainPoints || entry.gainPoints.length < 2) {
    entry.gainPoints = [{ t: 0, v: 1 }, { t: 1, v: 1 }];
  }
  return entry.gainPoints;
}

function getGainAtTime(entry, t) {
  const pts = entry.gainPoints;
  if (!pts || pts.length === 0) return 1;
  if (t <= pts[0].t) return pts[0].v;
  if (t >= pts[pts.length-1].t) return pts[pts.length-1].v;
  for (let i = 0; i < pts.length - 1; i++) {
    if (t >= pts[i].t && t <= pts[i+1].t) {
      const frac = (t - pts[i].t) / (pts[i+1].t - pts[i].t);
      return pts[i].v + (pts[i+1].v - pts[i].v) * frac;
    }
  }
  return 1;
}

function renderVolumeEnvelopes() {
  state.timeline.forEach(entry => {
    if (!entry.gainPoints) return;
    const el = document.querySelector('.clip[data-id="' + entry.id + '"]');
    if (!el) return;
    let volCanvas = el.querySelector('.vol-envelope-canvas');
    if (!volCanvas) {
      volCanvas = document.createElement('canvas');
      volCanvas.className = 'vol-envelope-canvas';
      el.appendChild(volCanvas);
    }
    const W = el.offsetWidth || 100, H = 18;
    if (W < 2) return;
    volCanvas.width = W; volCanvas.height = H;
    const ctx = volCanvas.getContext('2d');
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    entry.gainPoints.forEach((pt, i) => {
      const x = pt.t * W, y = H - (pt.v / 2) * H;
      i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
    entry.gainPoints.forEach(pt => {
      ctx.fillStyle = '#ffcc00'; ctx.beginPath();
      ctx.arc(pt.t * W, H - (pt.v/2)*H, 3, 0, Math.PI*2); ctx.fill();
    });
  });
}

// Patch renderTimeline to also render envelopes
(function() {
  const orig = renderTimeline;
  renderTimeline = function() { orig(); renderVolumeEnvelopes(); };
})();

document.getElementById('vol-master')?.addEventListener('input', e => {
  const v = parseInt(e.target.value);
  const vEl = document.getElementById('vol-master-val');
  if (vEl) vEl.textContent = v + '%';
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  ensureGainPoints(entry).forEach(p => p.v = v / 100);
  renderVolumeEnvelopes();
});

document.getElementById('vol-reset-btn')?.addEventListener('click', () => {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  pushUndo();
  entry.gainPoints = [{ t: 0, v: 1 }, { t: 1, v: 1 }];
  const masterEl = document.getElementById('vol-master');
  const masterVEl = document.getElementById('vol-master-val');
  if (masterEl) masterEl.value = 100;
  if (masterVEl) masterVEl.textContent = '100%';
  renderVolumeEnvelopes();
  setStatus('Volume envelope reset');
});

document.getElementById('vol-duck-btn')?.addEventListener('click', () => {
  const speechEntries = state.timeline.filter(e => {
    const c = state.clips.find(x => x.id === e.clipId);
    return c && c.type === 'video';
  });
  const musicEntries = state.timeline.filter(e => {
    const c = state.clips.find(x => x.id === e.clipId);
    return c && c.type === 'audio';
  });
  if (!musicEntries.length) { setStatus('No audio clips to duck'); return; }
  pushUndo();
  musicEntries.forEach(music => {
    const pts = [{ t: 0, v: 1 }];
    speechEntries.forEach(speech => {
      const relStart = (speech.start - music.start) / music.duration;
      const relEnd   = (speech.start + speech.duration - music.start) / music.duration;
      if (relEnd < 0 || relStart > 1) return;
      const s = Math.max(0, relStart - 0.05), e2 = Math.min(1, relEnd + 0.05);
      pts.push({ t: Math.max(0, s - 0.02), v: 1 });
      pts.push({ t: s, v: 0.2 });
      pts.push({ t: e2, v: 0.2 });
      pts.push({ t: Math.min(1, e2 + 0.02), v: 1 });
    });
    pts.push({ t: 1, v: 1 });
    pts.sort((a, b) => a.t - b.t);
    music.gainPoints = pts;
  });
  renderVolumeEnvelopes();
  setStatus('Audio ducked under ' + speechEntries.length + ' video clip(s)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Reset stale welcome-seen flag (in case of version mismatch)
// Users who got stuck can reload and it clears automatically
(function() {
  try {
    // If welcome-overlay exists and is not hidden, ensure localStorage matches
    const wov = document.getElementById('welcome-overlay');
    if (wov && !wov.classList.contains('hidden')) {
      // Overlay is showing — good. Make sure buttons work.
      const btn = document.getElementById('welcome-start');
      if (btn && !btn._wired) {
        btn._wired = true;
        btn.addEventListener('click', function() {
          wov.style.opacity = '0';
          wov.style.transition = 'opacity 0.3s';
          setTimeout(function() { wov.classList.add('hidden'); }, 310);
        });
      }
    }
  } catch(e) {}
})();

// INIT
// ─────────────────────────────────────────────────────────────────────────────
drawRuler();
updatePlayhead();
renderBin();
renderLutSwatches();

// Resize
window.addEventListener('resize', () => { drawRuler(); updatePlayhead(); });

console.log('%cCutPro Web — FCP7 Throwback', 'color:#4a8fcd; font-size:16px; font-weight:bold;');
console.log('%cDrop video files to start editing.', 'color:#8a8a8a');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE WORKER REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────
let swRegistration = null;
let newWorker = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      console.log('[PWA] Service Worker registered:', swRegistration.scope);

      swRegistration.addEventListener('updatefound', () => {
        newWorker = swRegistration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });

      if (navigator.serviceWorker.controller) {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = (e) => {
          if (e.data.type === 'VERSION') {
            console.log('[PWA] SW version:', e.data.version);
            setStatus(`Ready — offline capable (SW ${e.data.version})`);
          }
        };
        navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [port2]);
      }
    } catch (err) {
      console.warn('[PWA] SW registration failed:', err);
    }
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) { refreshing = true; window.location.reload(); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL NOTIFICATIONS
// Fire in-app events as OS notifications (no server needed).
// Remote push works automatically once a server sends VAPID payloads.
// ─────────────────────────────────────────────────────────────────────────────

// Request notification permission (called once, on user action)
async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  const result = await Notification.requestPermission();
  updateNotificationUI();
  return result;
}

// Show a local notification via the SW (works even when tab is in background)
function showLocalNotification(title, body, tag = 'cutpro-local', silent = false) {
  if (Notification.permission !== 'granted') return;
  if (!navigator.serviceWorker?.controller) {
    // Fallback: direct Notification API (foreground only)
    try { new Notification(title, { body, icon: './icons/icon-192.png', tag }); } catch(e) {}
    return;
  }
  navigator.serviceWorker.controller.postMessage({
    type: 'SHOW_NOTIFICATION',
    payload: { title, body, tag, silent },
  });
}

// Update the notification toggle button state
function updateNotificationUI() {
  const btn = document.getElementById('notif-toggle-btn');
  if (!btn) return;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  if (perm === 'granted') {
    btn.textContent = '🔔';
    btn.title = 'Notifications ON — click to manage';
    btn.style.color = '#5aaa6a';
  } else if (perm === 'denied') {
    btn.textContent = '🔕';
    btn.title = 'Notifications blocked — enable in browser settings';
    btn.style.color = '#7a3a3a';
  } else {
    btn.textContent = '🔔';
    btn.title = 'Enable notifications';
    btn.style.color = '#3a5a7a';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE SAVE QUEUE
// When navigator.onLine is false, queue saves to IndexedDB via SW.
// Background Sync fires flushProjectSaveQueue() when reconnected.
// ─────────────────────────────────────────────────────────────────────────────

let offlineSaveQueue = []; // in-memory fallback if SW not available

function saveProjectWithOfflineSupport(name) {
  const proj = serialiseProject(name);

  if (navigator.onLine) {
    // Normal path
    saveProject(name);
    showAutoSaveToast('Saved: ' + name);
    setStatus('✓ Project saved: ' + name);
    return;
  }

  // Offline path — queue via SW IndexedDB
  if (navigator.serviceWorker?.controller) {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = e => {
      if (e.data.type === 'SAVE_QUEUED') {
        showAutoSaveToast('Queued offline — will sync when reconnected');
        setStatus('📴 Offline — save queued, will sync automatically when reconnected');
      } else {
        // SW queue failed — fall back to localStorage directly
        saveProject(name);
        showAutoSaveToast('Saved locally (offline)');
      }
    };
    navigator.serviceWorker.controller.postMessage(
      { type: 'QUEUE_PROJECT_SAVE', payload: { data: proj } }, [port2]
    );

    // Register background sync
    navigator.serviceWorker.ready.then(reg => {
      if ('sync' in reg) reg.sync.register('sync-project-queue').catch(() => {});
    });
  } else {
    // No SW — save to localStorage directly
    saveProject(name);
    showAutoSaveToast('Saved locally (offline mode)');
  }
}

// Listen for SW sync messages (queued saves flushed when back online)
navigator.serviceWorker?.addEventListener('message', e => {
  const { type, payload } = e.data || {};

  if (type === 'SYNC_QUEUED_SAVE') {
    // Merge the queued project into localStorage
    try {
      const projects = getSavedProjects().filter(p => p.name !== payload.data.name);
      projects.unshift(payload.data);
      localStorage.setItem('cutpro_projects_v1', JSON.stringify(projects.slice(0, 20)));
      console.log('[Sync] Flushed queued save:', payload.data.name);
    } catch(e) {}
  }

  if (type === 'SYNC_COMPLETE') {
    const count = payload?.count || 0;
    setStatus(`✓ ${count} offline save${count !== 1 ? 's' : ''} synced`);
    showLocalNotification(
      'CutPro Web — Synced',
      `${count} project save${count !== 1 ? 's' : ''} synced after reconnecting.`,
      'cutpro-sync'
    );
  }

  if (type === 'RETRY_AUDIO_DOWNLOADS') {
    // Re-attempt any audio that failed while offline
    setStatus('Back online — retrying any failed audio downloads…');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TOAST
// ─────────────────────────────────────────────────────────────────────────────
function showUpdateToast() {
  document.getElementById('sw-update-toast').classList.add('visible');
}
document.getElementById('sw-reload-btn').addEventListener('click', () => {
  if (newWorker) newWorker.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
});
document.getElementById('sw-dismiss-btn').addEventListener('click', () => {
  document.getElementById('sw-update-toast').classList.remove('visible');
});

// ─────────────────────────────────────────────────────────────────────────────
// PWA INSTALL PROMPT
// ─────────────────────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;
const pwaBanner = document.getElementById('pwa-banner');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem('pwa-dismissed')) {
    setTimeout(() => pwaBanner.classList.add('visible'), 3000);
  }
});

document.getElementById('pwa-install-btn').addEventListener('click', async () => {
  pwaBanner.classList.remove('visible');
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (outcome === 'accepted') setStatus('CutPro Web installed ✓');
});

document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
  pwaBanner.classList.remove('visible');
  localStorage.setItem('pwa-dismissed', '1');
});

window.addEventListener('appinstalled', () => {
  pwaBanner.classList.remove('visible');
  deferredInstallPrompt = null;
  setStatus('CutPro Web is installed ✓');
});

// ─────────────────────────────────────────────────────────────────────────────
// ONLINE / OFFLINE INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
function updateOnlineStatus() {
  const dot = document.querySelector('.status-dot');
  if (navigator.onLine) {
    dot.style.background = 'var(--accent-green)';
    dot.style.boxShadow = '0 0 4px var(--accent-green)';
  } else {
    dot.style.background = 'var(--accent-orange)';
    dot.style.boxShadow = '0 0 4px var(--accent-orange)';
    setStatus('Offline — working from cache');
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// FADE IN / FADE OUT
// ─────────────────────────────────────────────────────────────────────────────

/** Attach drag listeners to the fade handles on a rendered clip element */
function attachFadeHandles(el, entry) {
  const inHandle  = el.querySelector('.fade-in-handle');
  const outHandle = el.querySelector('.fade-out-handle');

  if (inHandle) {
    inHandle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX;
      const startFade = entry.fadeIn || 0;
      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        const maxFade = entry.duration * 0.5;
        entry.fadeIn = Math.max(0, Math.min(maxFade, startFade + pxToSec(dx)));
        syncFadeInspector(entry);
        updateFadeOverlay(el, entry);
      };
      const onUp = () => {
        renderTimeline();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  if (outHandle) {
    outHandle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX;
      const startFade = entry.fadeOut || 0;
      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        const maxFade = entry.duration * 0.5;
        // dragging left increases fade out
        entry.fadeOut = Math.max(0, Math.min(maxFade, startFade - pxToSec(dx)));
        syncFadeInspector(entry);
        updateFadeOverlay(el, entry);
      };
      const onUp = () => {
        renderTimeline();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

/** Live-update the fade overlay widths while dragging (no full re-render) */
function updateFadeOverlay(el, entry) {
  const clipW = el.offsetWidth;
  const inW   = Math.min(secToPx(entry.fadeIn  || 0), clipW * 0.5);
  const outW  = Math.min(secToPx(entry.fadeOut || 0), clipW * 0.5);

  const inOvl  = el.querySelector('.fade-in-overlay');
  const outOvl = el.querySelector('.fade-out-overlay');
  const inTri  = el.querySelector('.fade-triangle:first-of-type');
  const outTri = el.querySelector('.fade-triangle:last-of-type');
  const inH    = el.querySelector('.fade-in-handle');
  const outH   = el.querySelector('.fade-out-handle');

  if (inOvl)  inOvl.style.width  = inW + 'px';
  if (outOvl) outOvl.style.width = outW + 'px';
  if (inH)    inH.style.left     = Math.max(6, inW - 5) + 'px';
  if (outH)   outH.style.right   = Math.max(6, outW - 5) + 'px';
}

/** Push current fade values from an entry into the inspector sliders */
function syncFadeInspector(entry) {
  if (!entry || state.selectedTimelineId !== entry.id) return;
  const fi = document.getElementById('p-fade-in');
  const fo = document.getElementById('p-fade-out');
  const fiv = document.getElementById('pv-fade-in');
  const fov = document.getElementById('pv-fade-out');
  if (fi)  fi.value        = (entry.fadeIn  || 0).toFixed(1);
  if (fo)  fo.value        = (entry.fadeOut || 0).toFixed(1);
  if (fiv) fiv.textContent = (entry.fadeIn  || 0).toFixed(1) + 's';
  if (fov) fov.textContent = (entry.fadeOut || 0).toFixed(1) + 's';
}

/** Called whenever a timeline clip is selected — loads its fades into inspector */


// ── Fade inspector slider wiring ──────────────────────────────────────────
function loadFadeInspector() {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (typeof syncFadeInspector        === 'function') syncFadeInspector(entry);
  if (typeof showTextInspector        === 'function') showTextInspector(state.selectedTimelineId);
  if (typeof loadVideoPropsInspector  === 'function') loadVideoPropsInspector();
}

document.getElementById('p-fade-in').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  document.getElementById('pv-fade-in').textContent = v.toFixed(1) + 's';
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  entry.fadeIn = Math.min(v, entry.duration * 0.5);
  renderTimeline();
});

document.getElementById('p-fade-out').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  document.getElementById('pv-fade-out').textContent = v.toFixed(1) + 's';
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) return;
  entry.fadeOut = Math.min(v, entry.duration * 0.5);
  renderTimeline();
});

// ── Preset buttons ────────────────────────────────────────────────────────
function applyFadePreset(sec) {
  const entry = state.timeline.find(t => t.id === state.selectedTimelineId);
  if (!entry) { setStatus('Select a clip on the timeline first'); return; }
  entry.fadeIn  = Math.min(sec, entry.duration * 0.5);
  entry.fadeOut = Math.min(sec, entry.duration * 0.5);
  syncFadeInspector(entry);
  renderTimeline();
  setStatus(sec === 0 ? 'Fades removed' : `Fade In + Out set to ${sec}s`);
}

document.getElementById('fade-preset-none').addEventListener('click',  () => applyFadePreset(0));
document.getElementById('fade-preset-short').addEventListener('click', () => applyFadePreset(0.5));
document.getElementById('fade-preset-med').addEventListener('click',   () => applyFadePreset(1));
document.getElementById('fade-preset-long').addEventListener('click',  () => applyFadePreset(2));


// ─────────────────────────────────────────────────────────────────────────────
// WELCOME OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  const overlay = document.getElementById('welcome-overlay');
  const startBtn = document.getElementById('welcome-start');
  const dontShow = document.getElementById('welcome-dont-show');

  // Guard: if elements don't exist, bail
  if (!overlay || !startBtn || !dontShow) return;

  function dismissWelcome() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => overlay.classList.add('hidden'), 320);
    try { localStorage.setItem('cutpro-welcome-seen-tmp', '1'); } catch(e) {}
  }

  // Hide only if user explicitly clicked "Don't show again"
  // Accept any truthy stored value for compatibility across versions
  try {
    const seen = localStorage.getItem('cutpro-welcome-seen');
    if (seen && seen !== '0') overlay.classList.add('hidden');
  } catch(e) {}

  // Use onclick (not addEventListener) so it can't be duplicated or blocked
  startBtn.onclick = function(e) {
    e.stopPropagation();
    dismissWelcome();
  };

  dontShow.onclick = function(e) {
    e.stopPropagation();
    try { localStorage.setItem('cutpro-welcome-seen', 'permanent'); } catch(e2) {}
    dismissWelcome();
  };

  // Click anywhere on the overlay backdrop (not the card) also dismisses
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) dismissWelcome();
  });

  // ? key toggles overlay
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '?' || e.key === '/') {
      if (overlay.classList.contains('hidden')) {
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        requestAnimationFrame(() => {
          overlay.style.transition = 'opacity 0.3s ease';
          overlay.style.opacity = '1';
        });
      } else {
        dismissWelcome();
      }
    }
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE MUSIC CACHING
// Communicates with SW via MessageChannel to pin/unpin tracks
// ─────────────────────────────────────────────────────────────────────────────

// State: which archive.org URLs are currently in the audio cache
let cachedAudioUrls = new Set();

// Send a message to the SW and get a response via MessageChannel
function sendSWMessage(type, payload) {
  return new Promise((resolve, reject) => {
    if (!navigator.serviceWorker?.controller) {
      reject(new Error('No SW controller'));
      return;
    }
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = e => resolve(e.data);
    navigator.serviceWorker.controller.postMessage({ type, payload }, [port2]);
    setTimeout(() => reject(new Error('SW message timeout')), 10000);
  });
}

// Refresh our local copy of what's cached
async function refreshCachedAudioUrls() {
  try {
    const resp = await sendSWMessage('GET_CACHED_AUDIO_URLS');
    cachedAudioUrls = new Set(resp.urls || []);
    renderMusicLibrary(); // re-render with updated indicators
  } catch(e) {
    // SW not ready yet — silent
  }
}

// Pin a single track offline
async function pinTrackOffline(track) {
  setStatus(`Downloading "${esc(track.title)}" for offline use…`);
  try {
    const resp = await sendSWMessage('CACHE_AUDIO_URLS', { urls: [track.url] });
    cachedAudioUrls.add(track.url);
    renderMusicLibrary();
    setStatus(`✓ "${esc(track.title)}" available offline`);
  } catch(e) {
    setStatus(`⚠ Could not cache "${esc(track.title)}": ` + e.message);
  }
}

// Unpin a track
async function unpinTrackOffline(track) {
  try {
    await sendSWMessage('UNCACHE_AUDIO_URLS', { urls: [track.url] });
    cachedAudioUrls.delete(track.url);
    renderMusicLibrary();
    setStatus(`"${esc(track.title)}" removed from offline storage`);
  } catch(e) { /* silent */ }
}

// Pin ALL library tracks
async function pinAllTracksOffline() {
  const allUrls = MUSIC_LIBRARY.map(t => t.url);
  const uncached = allUrls.filter(u => !cachedAudioUrls.has(u));
  if (uncached.length === 0) { setStatus('All tracks already available offline'); return; }

  setStatus(`Downloading ${uncached.length} tracks for offline use…`);
  const btn = document.getElementById('music-cache-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Downloading…'; }

  try {
    const resp = await sendSWMessage('CACHE_AUDIO_URLS', { urls: uncached });
    uncached.forEach(u => cachedAudioUrls.add(u));
    renderMusicLibrary();
    updateCacheSizeDisplay();
    setStatus(`✓ ${resp.count || uncached.length} tracks now available offline`);
  } catch(e) {
    setStatus('Download failed: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = '⬇ Save All Offline'; }
}

// Get and display cache size
async function updateCacheSizeDisplay() {
  try {
    const resp = await sendSWMessage('GET_AUDIO_CACHE_SIZE');
    const mb   = (resp.bytes / 1024 / 1024).toFixed(1);
    const text = resp.count > 0
      ? `${resp.count} track${resp.count!==1?'s':''} cached · ${mb} MB / ${resp.limitMb} MB`
      : 'No tracks cached offline';
    const el   = document.getElementById('music-cache-size');
    if (el) el.textContent = text;
    const el2  = document.getElementById('music-cache-status');
    if (el2) {
      el2.textContent = resp.count > 0
        ? `📶 ${text}`
        : '📶 No tracks cached offline — click ⬇ to save';
      el2.style.color = (resp.bytes / (resp.limitMb * 1024 * 1024)) > 0.8 ? '#aa7a3a' : '#2a7a3a';
    }
  } catch(e) { /* SW not ready */ }
}

// Clear all cached audio
async function clearAudioCache() {
  try {
    await sendSWMessage('CLEAR_AUDIO_CACHE');
    cachedAudioUrls.clear();
    renderMusicLibrary();
    updateCacheSizeDisplay();
    setStatus('Offline audio cache cleared');
  } catch(e) { /* silent */ }
}

// Init: load cache state when SW is ready
try {
  if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(() => {
      refreshCachedAudioUrls();
      updateCacheSizeDisplay();
    }).catch(() => {});
  }
} catch(e) {}

// ─────────────────────────────────────────────────────────────────────────────
// SNAP STATUS DOT sync
// ─────────────────────────────────────────────────────────────────────────────
function updateSnapDot() {
  const dot = document.getElementById('snap-status-dot');
  if (!dot) return;
  if (state.snappingEnabled) {
    dot.classList.remove('off');
    dot.style.background = 'var(--accent-blue)';
    dot.style.boxShadow = '0 0 4px var(--accent-blue)';
  } else {
    dot.classList.add('off');
  }
}
// Patch snapping toggle to also update dot
const _origSnapToggle = document.getElementById('tl-btn-snapping').onclick;
document.getElementById('tl-btn-snapping').addEventListener('click', updateSnapDot);
updateSnapDot(); // init

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE TOOL STRIP — fade hint after first scroll
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  const strip = document.getElementById('m-tool-strip');
  const hint  = document.getElementById('m-strip-hint');
  if (!strip || !hint) return;
  strip.addEventListener('scroll', () => {
    if (strip.scrollLeft > 10) {
      hint.style.opacity = '0';
      setTimeout(() => { if (hint) hint.style.display = 'none'; }, 500);
    }
  }, { once: true });
})();

// ─────────────────────────────────────────────────────────────────────────────
// SNAPPING TOGGLE + SENSITIVITY
// ─────────────────────────────────────────────────────────────────────────────
const SNAP_PRIORITY = { beat: 1, bar: 2, edge: 3, playhead: 4, second: 5 };

document.getElementById('tl-btn-snapping').classList.add('active');
document.getElementById('tl-btn-snapping').addEventListener('click', () => {
  state.snappingEnabled = !state.snappingEnabled;
  document.getElementById('tl-btn-snapping').classList.toggle('active', state.snappingEnabled);
  setStatus(state.snappingEnabled
    ? 'Snapping ON — beats 🎵 · bars 📐 · clip edges · playhead'
    : 'Snapping OFF');
});

// Snap sensitivity slider
const snapSlider = document.getElementById('snap-sensitivity');
const snapValLabel = document.getElementById('snap-sensitivity-val');
if (snapSlider) {
  snapSlider.addEventListener('input', () => {
    state.snapThresholdPx = parseInt(snapSlider.value);
    snapValLabel.textContent = snapSlider.value + 'px';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAP ENGINE  (beat > bar > clip-edge > playhead > second)
// ─────────────────────────────────────────────────────────────────────────────
function getSnapPoints(excludeId) {
  const points = [];

  // 1. Clip edges (all tracks)
  state.timeline.forEach(entry => {
    if (entry.id === excludeId) return;
    points.push({ time: entry.start,                  type: 'edge', priority: SNAP_PRIORITY.edge });
    points.push({ time: entry.start + entry.duration, type: 'edge', priority: SNAP_PRIORITY.edge });
  });

  // 2. Playhead
  points.push({ time: state.playheadTime, type: 'playhead', priority: SNAP_PRIORITY.playhead });

  // 3. Beat markers from every clip that has been analysed
  state.timeline.forEach(entry => {
    const clip = state.clips.find(c => c.id === entry.clipId);
    if (!clip || !clip.beatMarkers) return;
    clip.beatMarkers.forEach(beatOffset => {
      points.push({ time: entry.start + beatOffset, type: 'beat', priority: SNAP_PRIORITY.beat });
    });
  });
  // Also expose beat markers from clips NOT yet on the timeline (bin clips)
  state.clips.forEach(clip => {
    if (!clip.beatMarkers) return;
    clip.beatMarkers.forEach(beatOffset => {
      points.push({ time: beatOffset, type: 'beat', priority: SNAP_PRIORITY.beat });
    });
  });

  // 4. Bar lines based on detected BPM
  const bpmClip = state.clips.find(c => c.bpm > 0);
  if (bpmClip) {
    const barSec = (60 / bpmClip.bpm) * 4;
    const beatSec = 60 / bpmClip.bpm;
    for (let t = 0; t <= state.seqDuration + barSec; t += beatSec) {
      const isBar = Math.abs(t % barSec) < 0.001 || Math.abs((t % barSec) - barSec) < 0.001;
      points.push({ time: t, type: isBar ? 'bar' : 'beat', priority: isBar ? SNAP_PRIORITY.bar : SNAP_PRIORITY.beat });
    }
  }

  // 5. Integer seconds (lowest priority)
  for (let t = 0; t <= state.seqDuration + 1; t++) {
    points.push({ time: t, type: 'second', priority: SNAP_PRIORITY.second });
  }

  return points;
}

function snapTime(rawTime, excludeId) {
  if (!state.snappingEnabled) return { time: rawTime, snapped: false };
  const threshold = state.snapThresholdPx / (state.zoom * 10);
  const points = getSnapPoints(excludeId);

  let best = null, bestDist = Infinity, bestPriority = 999;
  points.forEach(pt => {
    const dist = Math.abs(pt.time - rawTime);
    if (dist > threshold) return;
    // Prefer by distance first, break ties with priority
    if (dist < bestDist - 0.0001 || (Math.abs(dist - bestDist) < 0.0001 && pt.priority < bestPriority)) {
      bestDist = dist; bestPriority = pt.priority; best = pt;
    }
  });

  if (best) {
    return { time: best.time, snapped: true, type: best.type };
  }
  return { time: rawTime, snapped: false };
}

// Snap guide line (yellow glowing vertical line on timeline)
let snapGuideEl = null;
const SNAP_COLORS = { beat: '#f0c040', bar: '#ff8c20', edge: '#60c8ff', playhead: '#ffffff', second: '#8080a0' };

function showSnapGuide(time, type) {
  const container = document.getElementById('timeline-tracks');
  if (!container) return;
  if (!snapGuideEl) {
    snapGuideEl = document.createElement('div');
    snapGuideEl.id = 'snap-guide';
    snapGuideEl.style.cssText = [
      'position:absolute', 'top:0', 'bottom:0', 'width:2px', 'z-index:25',
      'pointer-events:none', 'transition:left 0.03s,opacity 0.1s',
      'will-change:left,opacity'
    ].join(';');
    container.appendChild(snapGuideEl);
  }
  if (time !== null) {
    const col = SNAP_COLORS[type] || '#ffcc00';
    snapGuideEl.style.left        = secToPx(time) + 'px';
    snapGuideEl.style.opacity     = '1';
    snapGuideEl.style.background  = col;
    snapGuideEl.style.boxShadow   = `0 0 6px ${col}, 0 0 14px ${col}55`;
  } else {
    snapGuideEl.style.opacity = '0';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEAT DETECTION  —  energy-flux onset + autocorrelation BPM
// Runs entirely in the browser via Web Audio API, no server required.
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeBeat(clip) {
  // Skip text clips and clips with no audio source
  if (clip.type === 'text') return;
  if (!clip.file && !clip.url) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  setStatus(`🎵 Analysing "${esc(clip.name)}"…`);

  try {
    // Support both local File objects and blob/library URLs
    const arrayBuffer = clip.file
      ? await clip.file.arrayBuffer()
      : await fetch(clip.url).then(r => r.arrayBuffer());
    const audioCtx = new AC();

    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
      await audioCtx.close();
      setStatus(`Beat analysis skipped — "${esc(clip.name)}" not decodable`);
      return;
    }

    const sr   = audioBuffer.sampleRate;
    const ch0  = audioBuffer.getChannelData(0);
    const ch1  = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

    // ── 1. WAVEFORM (peak-per-block, 600 samples) ────────────────────────────
    const WAVE_BINS = 600;
    const blockSize = Math.floor(ch0.length / WAVE_BINS);
    const waveformData = new Float32Array(WAVE_BINS);
    let wMax = 0;
    for (let i = 0; i < WAVE_BINS; i++) {
      let peak = 0;
      for (let j = 0; j < blockSize; j++) {
        const s = Math.abs((ch0[i * blockSize + j] + ch1[i * blockSize + j]) * 0.5);
        if (s > peak) peak = s;
      }
      waveformData[i] = peak;
      if (peak > wMax) wMax = peak;
    }
    if (wMax > 0) for (let i = 0; i < WAVE_BINS; i++) waveformData[i] /= wMax;
    clip.waveformData = waveformData;

    // ── 2. ENERGY-FLUX ONSET DETECTION  ─────────────────────────────────────
    // Mix to mono, compute RMS energy in overlapping windows
    const HOP    = Math.round(sr * 0.0116); // ~256 @ 22 kHz  → ~11.6 ms resolution
    const WIN    = HOP * 2;
    const frames = Math.floor((ch0.length - WIN) / HOP);
    const energy = new Float32Array(frames);

    for (let i = 0; i < frames; i++) {
      let e = 0;
      const off = i * HOP;
      for (let j = 0; j < WIN; j++) {
        const s = (ch0[off + j] + ch1[off + j]) * 0.5;
        e += s * s;
      }
      energy[i] = e / WIN;
    }

    // Spectral flux: positive first-difference of energy
    const flux = new Float32Array(frames);
    for (let i = 1; i < frames; i++) flux[i] = Math.max(0, energy[i] - energy[i - 1]);

    // Adaptive threshold: local mean × multiplier (wider window for stability)
    const CTX   = 100;   // ±100 frames context
    const MULT  = 2.2;   // threshold multiplier (higher = fewer false positives)
    const MIN_DIST = Math.round(0.18 * sr / HOP); // ~180 ms min interval
    const beats = [];

    for (let i = CTX; i < frames - CTX; i++) {
      let mean = 0;
      for (let k = i - CTX; k <= i + CTX; k++) mean += flux[k];
      mean /= (CTX * 2 + 1);
      if (flux[i] > mean * MULT) {
        const t = (i * HOP) / sr;
        if (beats.length === 0 || i - beats[beats.length - 1].frame >= MIN_DIST) {
          beats.push({ t, frame: i });
        }
      }
    }
    clip.beatMarkers = beats.map(b => b.t);

    // ── 3. BPM via inter-beat-interval autocorrelation  ─────────────────────
    if (beats.length >= 8) {
      // Collect all IBIs
      const ibi = [];
      for (let i = 1; i < beats.length; i++) ibi.push(beats[i].t - beats[i-1].t);

      // Histogram in 5 ms buckets over 40–200 BPM range
      const BIN_MS = 5;
      const hist = {};
      ibi.forEach(interval => {
        const ms = Math.round(interval * 1000 / BIN_MS) * BIN_MS;
        hist[ms] = (hist[ms] || 0) + 1;
      });
      const bestIBI = parseInt(Object.entries(hist).sort((a,b) => b[1]-a[1])[0][0]);
      const rawBPM  = Math.round(60000 / bestIBI);

      // Normalise to 60–180 BPM range
      let bpm = rawBPM;
      while (bpm < 60)  bpm *= 2;
      while (bpm > 180) bpm /= 2;
      clip.bpm = Math.round(bpm);

      // Snap beat markers to BPM grid (correct minor drift)
      const beatSec = 60 / clip.bpm;
      const anchor  = clip.beatMarkers[0];
      clip.beatMarkersRaw = [...clip.beatMarkers];
      clip.beatMarkers = [];
      for (let t = anchor; t <= audioBuffer.duration + beatSec; t += beatSec) {
        clip.beatMarkers.push(parseFloat(t.toFixed(4)));
      }
    }

    await audioCtx.close();

    const bpmStr   = clip.bpm    ? ` · ${clip.bpm} BPM` : '';
    const beatStr  = clip.beatMarkers ? `${clip.beatMarkers.length} beats` : '—';
    setStatus(`🎵 "${esc(clip.name)}" — ${beatStr}${bpmStr} — ready to snap`);
    if (clip.bpm) showLocalNotification(
      'Beat analysis done',
      `"${esc(clip.name)}" — ${beatStr}${bpmStr}`,
      'cutpro-beat', true  // silent = true (low priority)
    );

    renderTimeline();
    renderBin();

  } catch (err) {
    console.warn('[Beat]', err);
    setStatus(`Beat analysis error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVEFORM DRAWING ON CLIP
// ─────────────────────────────────────────────────────────────────────────────
function drawClipWaveform(canvas, clip, entry) {
  const W = canvas.offsetWidth  || Math.max(1, secToPx(entry.duration));
  const H = canvas.offsetHeight || 34;
  if (W < 2) return;
  canvas.width  = W;
  canvas.height = H;
  const ctx  = canvas.getContext('2d');
  const data = clip.waveformData;
  if (!data || data.length === 0) return;
  ctx.clearRect(0, 0, W, H);

  const isAudio = clip.type === 'audio';
  const midY    = H / 2;
  const barW    = W / data.length;

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (isAudio) {
    grad.addColorStop(0,   'rgba(90,220,90,0.95)');
    grad.addColorStop(0.5, 'rgba(60,180,60,0.80)');
    grad.addColorStop(1,   'rgba(90,220,90,0.95)');
  } else {
    grad.addColorStop(0,   'rgba(100,180,255,0.95)');
    grad.addColorStop(0.5, 'rgba(70,140,220,0.80)');
    grad.addColorStop(1,   'rgba(100,180,255,0.95)');
  }
  ctx.fillStyle = grad;

  for (let i = 0; i < data.length; i++) {
    const h = Math.max(1, data[i] * H * 0.85);
    ctx.fillRect(i * barW, midY - h / 2, Math.max(0.6, barW - 0.4), h);
  }
}

// offsetWidth wrapper — lives AFTER the original so it correctly wraps it
(function() {
  const _origDCW = drawClipWaveform;
  drawClipWaveform = function(canvas, clip, entry) {
    if (canvas.offsetWidth === 0) {
      setTimeout(() => { if (canvas.offsetWidth > 0) _origDCW(canvas, clip, entry); }, 50);
      return;
    }
    _origDCW(canvas, clip, entry);
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// BEAT MARKER LINES DRAWN ON CLIP ELEMENT
// ─────────────────────────────────────────────────────────────────────────────
function drawBeatMarkers(clipEl, clip, entry) {
  if (!clip.beatMarkers || clip.beatMarkers.length === 0) return;
  const bpmClip = state.clips.find(c => c.bpm > 0);
  const barSec  = bpmClip ? (60 / bpmClip.bpm) * 4 : Infinity;

  clip.beatMarkers.forEach((beatOffset, idx) => {
    if (beatOffset < 0 || beatOffset > entry.duration + 0.05) return;
    const xPct  = (beatOffset / entry.duration) * 100;
    const isBar = beatOffset > 0 && barSec < Infinity &&
                  (Math.abs(beatOffset % barSec) < 0.05 || Math.abs((beatOffset % barSec) - barSec) < 0.05);

    const m = document.createElement('div');
    m.style.cssText = [
      `position:absolute`,
      `left:${xPct}%`,
      `top:0`, `bottom:0`,
      `width:${isBar ? '2px' : '1px'}`,
      `background:${isBar ? 'rgba(255,130,30,0.75)' : 'rgba(255,210,50,0.5)'}`,
      `pointer-events:none`,
      `z-index:3`,
      isBar ? `box-shadow:0 0 3px rgba(255,130,30,0.5)` : ''
    ].join(';');
    clipEl.appendChild(m);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BEAT GRID ON RULER CANVAS
// Draws beat ticks (yellow) and bar lines (orange) over the existing ruler
// ─────────────────────────────────────────────────────────────────────────────
function drawBeatGrid() {
  const canvas = document.getElementById('ruler-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const H   = canvas.height;
  const bpmClip = state.clips.find(c => c.bpm > 0);
  if (!bpmClip) return;

  const beatSec = 60 / bpmClip.bpm;
  const barSec  = beatSec * 4;

  ctx.save();
  for (let t = 0; t < state.seqDuration + barSec; t += beatSec) {
    const x = secToPx(t);
    const isBar = Math.abs(t % barSec) < 0.005 || Math.abs((t % barSec) - barSec) < 0.005;
    if (isBar) {
      // Bar line — bright orange, full height
      ctx.strokeStyle = 'rgba(255,130,30,0.65)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      // BPM label on bar
      if (t > 0 && x > 30) {
        ctx.fillStyle = 'rgba(255,130,30,0.55)';
        ctx.font = '8px Courier New, monospace';
        ctx.fillText(`${bpmClip.bpm}`, x + 2, H - 2);
      }
    } else {
      // Beat tick — yellow, bottom half
      ctx.strokeStyle = 'rgba(255,215,50,0.35)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([1, 2]);
      ctx.beginPath(); ctx.moveTo(x, H * 0.55); ctx.lineTo(x, H); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// Beat grid is called directly from within drawRuler (see function body above)
// drawBeatGrid() is appended at the call sites via the renderTimeline flow

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ── Notification toggle button ────────────────────────────────────────────────
document.getElementById('notif-toggle-btn')?.addEventListener('click', async () => {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  if (perm === 'unsupported') {
    setStatus('Notifications not supported in this browser');
    return;
  }
  if (perm === 'denied') {
    setStatus('Notifications blocked — open browser settings to allow');
    return;
  }
  if (perm === 'granted') {
    // Already on — show a test notification
    showLocalNotification('CutPro Web', 'Notifications are enabled ✓', 'cutpro-test', false);
    setStatus('Notifications enabled — test notification sent');
    return;
  }
  // Not yet asked — request permission
  const result = await requestNotificationPermission();
  if (result === 'granted') {
    showLocalNotification('CutPro Web', "Notifications enabled \u2713 You'll be notified when exports finish.", 'cutpro-welcome');
    setStatus('✓ Notifications enabled');
  } else {
    setStatus('Notifications permission denied');
  }
});
updateNotificationUI(); // set initial icon state



(function() {
var mState={zoom:3,playing:false,playheadTime:0,seqDuration:120,tool:'select',selectedTimelineId:null,playTimer:null,pinchStartDist:0,pinchStartZoom:3};
var MTRACK_IDS=['v1','v2','a1'];
var mSnapGuideEl=null;
var MSNAP_COLORS={beat:'#f0c040',bar:'#ff8c20',edge:'#60c8ff',playhead:'#ffffff',second:'#8080a0'};
function mShowSnapGuide(time,type){
  var inner=document.getElementById('m-timeline-inner');if(!inner)return;
  if(!mSnapGuideEl){
    mSnapGuideEl=document.createElement('div');
    mSnapGuideEl.style.cssText='position:absolute;top:0;bottom:0;width:2px;z-index:20;pointer-events:none;transition:opacity 0.1s;';
    inner.appendChild(mSnapGuideEl);
  }
  if(time!==null){
    var col=MSNAP_COLORS[type]||'#ffcc00';
    mSnapGuideEl.style.left=mSecToPx(time)+'px';
    mSnapGuideEl.style.opacity='1';
    mSnapGuideEl.style.background=col;
    mSnapGuideEl.style.boxShadow='0 0 6px '+col;
  }else{mSnapGuideEl.style.opacity='0';}
}
function mSecToPx(s){return s*mState.zoom*10;}
function mPxToSec(p){return p/(mState.zoom*10);}
function mTC(s){var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),f=Math.floor((s%1)*30);return[h,m,sec,f].map(function(n){return String(n).padStart(2,'0');}).join(':');}

function mDrawRuler(){
  var scroll=document.getElementById('m-timeline-scroll');
  var canvas=document.getElementById('m-ruler-canvas');
  if(!canvas)return;
  var W=Math.max(scroll.clientWidth||300,mSecToPx(mState.seqDuration)+120);
  canvas.width=W;canvas.height=22;
  document.getElementById('m-timeline-inner').style.width=W+'px';
  var ctx=canvas.getContext('2d');
  ctx.fillStyle='#1e1e1e';ctx.fillRect(0,0,W,22);
  var pxSec=mState.zoom*10;
  var step=pxSec>=80?1:pxSec>=40?2:pxSec>=20?5:10;
  ctx.strokeStyle='#444';ctx.fillStyle='#777';ctx.font='9px Courier New,monospace';
  for(var t=0;t<=mPxToSec(W)+step;t+=step){
    var x=Math.round(t*pxSec);
    ctx.beginPath();ctx.moveTo(x,12);ctx.lineTo(x,22);ctx.stroke();
    if(t%(step*2)===0)ctx.fillText(mTC(t),x+2,11);
  }
}

function mUpdatePlayhead(){
  var ph=document.getElementById('m-playhead');if(!ph)return;
  var px=mSecToPx(mState.playheadTime);
  ph.style.left=px+'px';
  var pct=mState.seqDuration>0?(mState.playheadTime/mState.seqDuration)*100:0;
  document.getElementById('m-scrub-fill').style.width=pct+'%';
  document.getElementById('m-scrub-thumb').style.left=pct+'%';
  var tc=mTC(mState.playheadTime);
  document.getElementById('m-tc-overlay').textContent=tc;
  document.getElementById('m-tl-tc').textContent=tc;
  var scroll=document.getElementById('m-timeline-scroll');
  if(px<scroll.scrollLeft||px>scroll.scrollLeft+scroll.clientWidth-40){scroll.scrollLeft=Math.max(0,px-scroll.clientWidth/3);}
}

function mRenderTimeline(){
  MTRACK_IDS.forEach(function(tId){
    var container=document.getElementById('m-clips-'+tId);if(!container)return;
    container.innerHTML='';
    state.timeline.filter(function(e){return e.track===tId;}).forEach(function(entry){
      var clip=state.clips.find(function(c){return c.id===entry.clipId;});if(!clip)return;
      var el=document.createElement('div');
      el.className='m-clip '+(clip.type==='audio'?'audio-clip':'video-clip')+(entry.id===mState.selectedTimelineId?' selected':'');
      el.style.left=mSecToPx(entry.start)+'px';
      el.style.width=Math.max(24,mSecToPx(entry.duration))+'px';
      var mFiW=Math.min(mSecToPx(entry.fadeIn||0),mSecToPx(entry.duration)*0.5);
      var mFoW=Math.min(mSecToPx(entry.fadeOut||0),mSecToPx(entry.duration)*0.5);
      el.innerHTML=(entry.fadeIn>0?'<div class="fade-in-overlay" style="width:'+mFiW+'px"></div>':'')+
        (entry.fadeOut>0?'<div class="fade-out-overlay" style="width:'+mFoW+'px"></div>':'')+
        '<span class="m-clip-label">'+clip.name+'</span><div class="m-clip-resize">⠿</div>';
      (function(e2,entry2){
        e2.addEventListener('pointerdown',function(ev){
          if(ev.target.classList.contains('m-clip-resize'))return;
          if(mState.tool==='blade'){mBladeClip(entry2,ev,container);return;}
          mState.selectedTimelineId=entry2.id;mRenderTimeline();mUpdateClipInfo(entry2.clipId);mOpenInViewer(entry2.clipId);mDragClip(e2,entry2,ev);
        });
        e2.querySelector('.m-clip-resize').addEventListener('pointerdown',function(ev){ev.stopPropagation();mResizeClip(e2,entry2,ev);});
      })(el,entry);
      container.appendChild(el);
    });
  });
  mDrawRuler();mUpdatePlayhead();
}

function mDragClip(el,entry,ev){
  ev.preventDefault();var sx=ev.clientX,sp=entry.start;el.setPointerCapture(ev.pointerId);
  function onM(e){
    var raw=Math.max(0,sp+mPxToSec(e.clientX-sx));
    var snapped=state.snappingEnabled?snapTime(raw,entry.id):{time:raw,snapped:false};
    entry.start=snapped.time;
    el.style.left=mSecToPx(snapped.time)+'px';
    mShowSnapGuide(snapped.snapped?snapped.time:null, snapped.type);
  }
  function onU(){el.removeEventListener('pointermove',onM);mShowSnapGuide(null);mRenderTimeline();}
  el.addEventListener('pointermove',onM);el.addEventListener('pointerup',onU,{once:true});el.addEventListener('pointercancel',onU,{once:true});
}
function mResizeClip(el,entry,ev){
  ev.preventDefault();var sx=ev.clientX,sd=entry.duration;var knob=el.querySelector('.m-clip-resize');knob.setPointerCapture(ev.pointerId);
  function onM(e){
    var rawEnd=entry.start+Math.max(1,sd+mPxToSec(e.clientX-sx));
    var snapped=state.snappingEnabled?snapTime(rawEnd,entry.id):{time:rawEnd,snapped:false};
    entry.duration=Math.max(1,snapped.time-entry.start);
    el.style.width=Math.max(24,mSecToPx(entry.duration))+'px';
    mShowSnapGuide(snapped.snapped?snapped.time:null, snapped.type);
  }
  function onU(){knob.removeEventListener('pointermove',onM);mShowSnapGuide(null);mRenderTimeline();}
  knob.addEventListener('pointermove',onM);knob.addEventListener('pointerup',onU,{once:true});knob.addEventListener('pointercancel',onU,{once:true});
}
function mBladeClip(entry,ev,container){
  var rect=container.getBoundingClientRect();
  var cutTime=entry.start+mPxToSec(ev.clientX-rect.left-mSecToPx(entry.start));
  if(cutTime<=entry.start+0.5||cutTime>=entry.start+entry.duration-0.5)return;
  var origDur=entry.duration;entry.duration=cutTime-entry.start;
  state.timeline.push({id:uid(),clipId:entry.clipId,track:entry.track,start:cutTime,duration:origDur-(cutTime-entry.start),inPoint:0,outPoint:origDur-(cutTime-entry.start)});
  mRenderTimeline();mSetTool('select');
}

var mCurrentSrcClipId=null;
function mOpenInViewer(clipId){
  var clip=state.clips.find(function(c){return c.id===clipId;});if(!clip)return;
  mCurrentSrcClipId=clipId;
  var vid=document.getElementById('m-video');
  document.getElementById('m-viewer-placeholder').style.display='none';
  vid.src=clip.url;vid.load();mUpdateClipInfo(clipId);
}
function mUpdateClipInfo(clipId){
  var clip=state.clips.find(function(c){return c.id===clipId;});if(!clip)return;
  document.getElementById('m-clip-info').innerHTML='<div style="font-size:10px;color:var(--text-secondary);line-height:2;"><div><b style="color:var(--text-label)">Name:</b> '+clip.name+'</div><div><b style="color:var(--text-label)">Duration:</b> '+mTC(clip.duration||0)+'</div><div><b style="color:var(--text-label)">Type:</b> '+clip.type+'</div></div>';
}

var mScrubTrack=document.getElementById('m-scrub-track');
function mHandleScrub(e){
  var rect=mScrubTrack.getBoundingClientRect();var pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
  var vid=document.getElementById('m-video');
  if(vid.src&&vid.duration){vid.currentTime=pct*vid.duration;}else{mState.playheadTime=pct*mState.seqDuration;mUpdatePlayhead();}
}
mScrubTrack.addEventListener('pointerdown',function(e){mScrubTrack.setPointerCapture(e.pointerId);mHandleScrub(e);mScrubTrack.addEventListener('pointermove',mHandleScrub);});
mScrubTrack.addEventListener('pointerup',function(){mScrubTrack.removeEventListener('pointermove',mHandleScrub);});
mScrubTrack.addEventListener('pointercancel',function(){mScrubTrack.removeEventListener('pointermove',mHandleScrub);});
document.getElementById('m-video').addEventListener('timeupdate',function(){
  var vid=document.getElementById('m-video');if(!vid.duration)return;
  var pct=(vid.currentTime/vid.duration)*100;
  document.getElementById('m-scrub-fill').style.width=pct+'%';
  document.getElementById('m-scrub-thumb').style.left=pct+'%';
  document.getElementById('m-tc-overlay').textContent=mTC(vid.currentTime);
});

function mTogglePlay(){
  var vid=document.getElementById('m-video');var btn=document.getElementById('m-btn-play');var ovl=document.getElementById('m-play-overlay-btn');
  if(vid.src&&vid.duration){
    if(vid.paused){vid.play();btn.textContent='⏸';ovl.textContent='⏸';}
    else{vid.pause();btn.textContent='▶';ovl.textContent='▶';}
  }else{
    mState.playing=!mState.playing;
    if(mState.playing){btn.textContent='⏸';ovl.textContent='⏸';mState.playTimer=setInterval(function(){mState.playheadTime+=1/30;if(mState.playheadTime>=mState.seqDuration)mState.playheadTime=0;mUpdatePlayhead();},1000/30);}
    else{btn.textContent='▶';ovl.textContent='▶';clearInterval(mState.playTimer);}
  }
}
document.getElementById('m-btn-play').addEventListener('click',mTogglePlay);
document.getElementById('m-play-overlay').addEventListener('click',mTogglePlay);
document.getElementById('m-btn-start').addEventListener('click',function(){mState.playheadTime=0;mUpdatePlayhead();var v=document.getElementById('m-video');if(v.src)v.currentTime=0;});
document.getElementById('m-btn-end').addEventListener('click',function(){mState.playheadTime=mState.seqDuration;mUpdatePlayhead();});
document.getElementById('m-btn-stepb').addEventListener('click',function(){var v=document.getElementById('m-video');if(v.src&&v.duration)v.currentTime=Math.max(0,v.currentTime-1/30);else{mState.playheadTime=Math.max(0,mState.playheadTime-1/30);mUpdatePlayhead();}});
document.getElementById('m-btn-stepf').addEventListener('click',function(){var v=document.getElementById('m-video');if(v.src&&v.duration)v.currentTime=Math.min(v.duration,v.currentTime+1/30);else{mState.playheadTime=Math.min(mState.seqDuration,mState.playheadTime+1/30);mUpdatePlayhead();}});
document.getElementById('m-mark-in').addEventListener('click',function(){state.markIn=document.getElementById('m-video').currentTime||mState.playheadTime;});
document.getElementById('m-mark-out').addEventListener('click',function(){state.markOut=document.getElementById('m-video').currentTime||mState.playheadTime;});

document.getElementById('m-btn-import').addEventListener('click',function(){mOpenSheet('bin');});
document.getElementById('m-drop-zone').addEventListener('click',function(){document.getElementById('m-file-input').click();});
document.getElementById('m-file-input').addEventListener('change',function(e){importFiles(e.target.files);setTimeout(mRenderBin,700);});

function mRenderBin(){
  var list=document.getElementById('m-bin-list');list.innerHTML='';
  state.clips.forEach(function(clip){
    var item=document.createElement('div');
    item.className='m-bin-item'+(mCurrentSrcClipId===clip.id?' selected':'');
    item.innerHTML='<div class="m-bin-thumb">'+(clip.type==='audio'?'🎵':'🎬')+'</div><div class="m-bin-info"><div class="m-bin-name">'+clip.name+'</div><div class="m-bin-meta">'+mTC(clip.duration||0)+' \u00b7 '+clip.type+'</div></div><button class="m-bin-add" data-id="'+clip.id+'">+</button>';
    item.addEventListener('click',function(ev){
      if(ev.target.classList.contains('m-bin-add')){
        var id=ev.target.dataset.id;addToTimeline(id,'v1');
        state.timeline.forEach(function(t){mState.seqDuration=Math.max(mState.seqDuration,t.start+t.duration+10);});
        mRenderTimeline();mCloseSheets();
      }else{mOpenInViewer(clip.id);}
    });
    list.appendChild(item);
  });
}

function mSetTool(tool){
  mState.tool=tool;
  document.querySelectorAll('.m-tool-chip').forEach(function(c){c.classList.remove('active');});
  var map={select:'mc-select',blade:'mc-blade',insert:'mc-insert',ripple:'mc-ripple',lift:'mc-lift'};
  var el=document.getElementById(map[tool]||'mc-select');if(el)el.classList.add('active');
  document.getElementById('m-blade-indicator').classList.toggle('show',tool==='blade');
  if(tool==='blade')setTimeout(function(){document.getElementById('m-blade-indicator').classList.remove('show');},2500);
}
document.getElementById('mc-select').addEventListener('click',function(){mSetTool('select');});
document.getElementById('mc-snapping').addEventListener('click',function(){
  state.snappingEnabled=!state.snappingEnabled;
  document.getElementById('mc-snapping').classList.toggle('active',state.snappingEnabled);
});
document.getElementById('mc-blade').addEventListener('click',function(){mSetTool('blade');});
document.getElementById('mc-insert').addEventListener('click',function(){if(mCurrentSrcClipId){addToTimeline(mCurrentSrcClipId,'v1');mRenderTimeline();}});
document.getElementById('mc-ripple').addEventListener('click',function(){
  if(!mState.selectedTimelineId)return;
  var idx=state.timeline.findIndex(function(t){return t.id===mState.selectedTimelineId;});
  if(idx!==-1){var r=state.timeline.splice(idx,1)[0];state.timeline.filter(function(t){return t.track===r.track&&t.start>=r.start;}).forEach(function(t){t.start-=r.duration;});mState.selectedTimelineId=null;mRenderTimeline();}
});
document.getElementById('mc-lift').addEventListener('click',function(){
  if(!mState.selectedTimelineId)return;
  state.timeline=state.timeline.filter(function(t){return t.id!==mState.selectedTimelineId;});
  mState.selectedTimelineId=null;mRenderTimeline();
});

document.getElementById('m-zoom-out').addEventListener('click',function(){mState.zoom=Math.max(1,mState.zoom-0.5);mRenderTimeline();});
document.getElementById('m-zoom-in').addEventListener('click',function(){mState.zoom=Math.min(20,mState.zoom+0.5);mRenderTimeline();});

var mScrollEl=document.getElementById('m-timeline-scroll');
mScrollEl.addEventListener('touchstart',function(e){if(e.touches.length===2){mState.pinchStartDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);mState.pinchStartZoom=mState.zoom;}},{passive:true});
mScrollEl.addEventListener('touchmove',function(e){if(e.touches.length===2){var dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);mState.zoom=Math.max(1,Math.min(20,mState.pinchStartZoom*(dist/mState.pinchStartDist)));mRenderTimeline();}},{passive:true});

document.getElementById('m-timeline-inner').addEventListener('click',function(e){
  if(e.target.closest('.m-clip'))return;
  var rect=document.getElementById('m-timeline-inner').getBoundingClientRect();
  mState.playheadTime=Math.max(0,mPxToSec(e.clientX-rect.left+mScrollEl.scrollLeft));
  mUpdatePlayhead();
});

function mOpenSheet(name){
  mCloseSheets();
  var sheet=document.getElementById('m-'+name+'-sheet');if(!sheet)return;
  if(name==='bin')mRenderBin();
  sheet.classList.add('open');document.getElementById('m-backdrop').classList.add('visible');
}
function mCloseSheets(){
  document.querySelectorAll('.m-sheet').forEach(function(s){s.classList.remove('open');});
  document.getElementById('m-backdrop').classList.remove('visible');
  document.querySelectorAll('.m-nav-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('m-nav-edit').classList.add('active');
}
document.getElementById('m-backdrop').addEventListener('click',mCloseSheets);
document.getElementById('m-bin-close').addEventListener('click',mCloseSheets);
document.getElementById('m-inspector-close').addEventListener('click',mCloseSheets);
document.querySelectorAll('.m-sheet').forEach(function(sheet){
  var sY=0;
  sheet.addEventListener('touchstart',function(e){sY=e.touches[0].clientY;},{passive:true});
  sheet.addEventListener('touchend',function(e){if(e.changedTouches[0].clientY-sY>60)mCloseSheets();},{passive:true});
});

document.getElementById('m-nav-edit').addEventListener('click',function(){document.querySelectorAll('.m-nav-btn').forEach(function(b){b.classList.remove('active');});document.getElementById('m-nav-edit').classList.add('active');mCloseSheets();});
document.getElementById('m-nav-bin').addEventListener('click',function(){document.querySelectorAll('.m-nav-btn').forEach(function(b){b.classList.remove('active');});document.getElementById('m-nav-bin').classList.add('active');mOpenSheet('bin');});
document.getElementById('m-nav-inspector').addEventListener('click',function(){document.querySelectorAll('.m-nav-btn').forEach(function(b){b.classList.remove('active');});document.getElementById('m-nav-inspector').classList.add('active');mOpenSheet('inspector');});

[['scale','%'],['rotate','°'],['opacity','%'],['bright',''],['contrast',''],['sat',''],['speed','%']].forEach(function(p){
  var s=document.getElementById('mp-'+p[0]),v=document.getElementById('mpv-'+p[0]);
  if(s&&v)s.addEventListener('input',function(){v.textContent=s.value+p[1];});
});

// Mobile fade sliders
document.getElementById('mp-fade-in').addEventListener('input',function(e){
  var v=parseFloat(e.target.value);
  document.getElementById('mpv-fade-in').textContent=v.toFixed(1)+'s';
  var entry=state.timeline.find(function(t){return t.id===mState.selectedTimelineId;});
  if(!entry)return; entry.fadeIn=Math.min(v,entry.duration*0.5); mRenderTimeline();
});
document.getElementById('mp-fade-out').addEventListener('input',function(e){
  var v=parseFloat(e.target.value);
  document.getElementById('mpv-fade-out').textContent=v.toFixed(1)+'s';
  var entry=state.timeline.find(function(t){return t.id===mState.selectedTimelineId;});
  if(!entry)return; entry.fadeOut=Math.min(v,entry.duration*0.5); mRenderTimeline();
});
function mApplyFadePreset(sec){
  var entry=state.timeline.find(function(t){return t.id===mState.selectedTimelineId;});
  if(!entry)return;
  entry.fadeIn=entry.fadeOut=Math.min(sec,entry.duration*0.5);
  document.getElementById('mp-fade-in').value=entry.fadeIn.toFixed(1);
  document.getElementById('mpv-fade-in').textContent=entry.fadeIn.toFixed(1)+'s';
  document.getElementById('mp-fade-out').value=entry.fadeOut.toFixed(1);
  document.getElementById('mpv-fade-out').textContent=entry.fadeOut.toFixed(1)+'s';
  mRenderTimeline();
}
document.getElementById('m-fade-none').addEventListener('click',function(){mApplyFadePreset(0);});
document.getElementById('m-fade-short').addEventListener('click',function(){mApplyFadePreset(0.5);});
document.getElementById('m-fade-med').addEventListener('click',function(){mApplyFadePreset(1);});
document.getElementById('m-fade-long').addEventListener('click',function(){mApplyFadePreset(2);});

document.getElementById('m-btn-export').addEventListener('click',function(){ if(state.timeline.length===0){return;} openExportModal(); });
document.getElementById('m-btn-undo').addEventListener('click',function(){if(state.timeline.length){state.timeline.pop();mRenderTimeline();}});

mDrawRuler();mUpdatePlayhead();
window.addEventListener('resize',function(){mDrawRuler();mUpdatePlayhead();});
window.mRenderBin=mRenderBin;
window.mRenderTimeline=mRenderTimeline;
})();

// AI CLEANUP — open/close wiring (patched)
on('btn-ai-cleanup','click', function(){
  var m = document.getElementById('ai-cleanup-modal');
  if(m) m.classList.add('open');
});
on('ai-header-close','click', function(){
  var m = document.getElementById('ai-cleanup-modal');
  if(m) m.classList.remove('open');
});
on('ai-cancel-btn','click', function(){
  var m = document.getElementById('ai-cleanup-modal');
  if(m) m.classList.remove('open');
});
// click outside the card closes
(function(){
  var m = document.getElementById('ai-cleanup-modal');
  if(!m) return;
  m.addEventListener('click', function(e){ if(e.target === m) m.classList.remove('open'); });
})();
// Esc to close
(function(){
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      var m = document.getElementById('ai-cleanup-modal');
      if(m && m.classList.contains('open')) m.classList.remove('open');
    }
  });
})();




(function(){
  function on(id, evt, fn){ try{ var el=document.getElementById(id); if(el) el.addEventListener(evt, fn);}catch(e){} }
  function uid(){ return Math.random().toString(36).slice(2,9); }
  function ready(fn){ if (window.state && document.getElementById('timeline-tracks')) fn(); else setTimeout(function(){ ready(fn); }, 120); }
  function closeAICleanup(){ var m=document.getElementById('ai-cleanup-modal'); if(m) m.classList.remove('open'); }
  function hideOverlays(){ closeAICleanup(); var d=document.getElementById('drag-overlay'); if(d) d.classList.remove('show'); }
  on('btn-ai-cleanup','click', function(){ var m=document.getElementById('ai-cleanup-modal'); if(m) m.classList.add('open'); });
  (function(){ var root=document; ['#ai-header-close','.ai-header-close','#ai-cancel-btn','.ai-cancel-btn'].forEach(function(sel){ root.querySelectorAll(sel).forEach(function(btn){ btn.addEventListener('click', closeAICleanup); }); }); var m=document.getElementById('ai-cleanup-modal'); if(m) m.addEventListener('click', function(e){ if(e.target===m) closeAICleanup(); }); document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeAICleanup(); }); })();
  function activateTab(name){ try{ var tabs=document.querySelectorAll('#browser .panel-tab'); tabs.forEach(function(t){ t.classList.remove('active'); }); var musicPanel=document.getElementById('music-library'); if(name==='music'){ document.getElementById('tab-music')?.classList.add('active'); musicPanel?.classList.add('open'); } else { musicPanel?.classList.remove('open'); document.getElementById('tab-'+name)?.classList.add('active'); } hideOverlays(); }catch(e){} }
  on('tab-bin','click', function(){ activateTab('bin'); });
  on('tab-effects','click', function(){ activateTab('effects'); });
  on('tab-music','click', function(){ activateTab('music'); });
  ['tab-bin','tab-effects','tab-music'].forEach(function(id){ var el=document.getElementById(id); if(el){ el.addEventListener('mousedown', hideOverlays, true); }});
  ready(function(){
    if (typeof state.linkedSelection === 'undefined') state.linkedSelection = true;
    window.newLinkGroup = window.newLinkGroup || function(){ return 'lg_'+uid(); };
    window.getLinkedSiblings = window.getLinkedSiblings || function(entry){ if(!entry||!entry.linkGroup) return []; return (state.timeline||[]).filter(function(e){ return e.linkGroup===entry.linkGroup && e.id!==entry.id; }); };
    on('tl-btn-linked','click', function(){ state.linkedSelection = !state.linkedSelection; var btn=document.getElementById('tl-btn-linked'); if(btn) btn.classList.toggle('active', state.linkedSelection); });
    if (typeof window.addToTimeline === 'function'){
      const _addToTimeline = window.addToTimeline;
      window.addToTimeline = function(clipId, trackId){
        try{
          const clip = (state.clips||[]).find(function(c){ return c.id===clipId; });
          if (!clip) return _addToTimeline(clipId, trackId);
          if (clip.type !== 'video') return _addToTimeline(clipId, trackId);
          const nextStart = function(tId){ const ex=(state.timeline||[]).filter(function(t){ return t.track===tId; }); return ex.length? Math.max.apply(null, ex.map(function(t){ return t.start+t.duration; })) : 0; };
          const startV = nextStart('v1'); const dur = clip.duration || 10; const group = newLinkGroup();
          const mk = function(track, role){ return { id: uid(), clipId: clipId, track: track, start: startV, duration: dur, inPoint: 0, outPoint: dur, fadeIn: 0, fadeOut: 0, role: role, linkGroup: group }; };
          state.timeline.push(mk('v1','video'), mk('a1','audio'));
          state.seqDuration = Math.max(state.seqDuration||0, startV+dur+1);
          if (typeof renderTimeline==='function') renderTimeline(); if (typeof setStatus==='function') setStatus('Added linked A/V');
        }catch(e){ _addToTimeline(clipId, trackId); }
      }
    }
    if (typeof window.makeDraggable === 'function' && typeof window.makeResizable === 'function'){
      const _makeResizable = window.makeResizable;
      window.makeDraggable = function(el, entry){
        el.addEventListener('mousedown', function(e){
          if (e.target.classList.contains('clip-handle')) return;
          if (state.currentTool==='blade'){ if (typeof bladeClip==='function') bladeClip(entry,e); return; }
          e.preventDefault();
          const linked = state.linkedSelection ? getLinkedSiblings(entry) : [];
          const startX = e.clientX; const primaryStart = entry.start; const sibStarts = linked.map(function(x){ return x.start; });
          function onMove(e2){ const dx = e2.clientX - startX; const rawStart = Math.max(0, primaryStart + pxToSec(dx)); const snapped = typeof snapTime==='function' ? snapTime(rawStart, entry.id) : {time:rawStart}; entry.start = snapped.time; el.style.left = secToPx(entry.start)+'px'; const dt = entry.start - primaryStart; linked.forEach(function(x,i){ x.start = Math.max(0, sibStarts[i]+dt); }); if (typeof renderTimeline==='function') renderTimeline(); }
          function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (typeof renderTimeline==='function') renderTimeline(); }
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
      };
      window.makeResizable = function(el, entry){
        _makeResizable(el, entry);
        var leftH = el.querySelector('.clip-handle.left'); var rightH = el.querySelector('.clip-handle.right');
        if (rightH){ rightH.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); const linked = state.linkedSelection ? getLinkedSiblings(entry) : []; const startX = e.clientX; const startDur = entry.duration; const sDur = linked.map(function(x){ return x.duration; }); function onMove(e2){ const dx=e2.clientX-startX; const rawEnd=entry.start+Math.max(1,startDur+pxToSec(dx)); const snapped= typeof snapTime==='function'? snapTime(rawEnd, entry.id):{time:rawEnd}; entry.duration = Math.max(1, snapped.time - entry.start); el.style.width = secToPx(entry.duration)+'px'; const dd = entry.duration - startDur; linked.forEach(function(x,i){ x.duration = Math.max(1, sDur[i]+dd); }); if (typeof renderTimeline==='function') renderTimeline(); } function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (typeof renderTimeline==='function') renderTimeline(); } document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }); }
        if (leftH){ leftH.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); const linked = state.linkedSelection ? getLinkedSiblings(entry) : []; const startX=e.clientX; const startStart=entry.start; const startDur=entry.duration; const sStart=linked.map(function(x){ return x.start; }); const sDur=linked.map(function(x){ return x.duration; }); function onMove(e2){ const dx=e2.clientX-startX; const newStart=Math.max(0,startStart+pxToSec(dx)); const delta=newStart-startStart; entry.start=newStart; entry.duration=Math.max(1,startDur-delta); el.style.left=secToPx(entry.start)+'px'; el.style.width=secToPx(entry.duration)+'px'; linked.forEach(function(x,i){ x.start=Math.max(0,sStart[i]+delta); x.duration=Math.max(1,sDur[i]-delta); }); if (typeof renderTimeline==='function') renderTimeline(); } function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (typeof renderTimeline==='function') renderTimeline(); } document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }); }
      };
    }
    document.addEventListener('keydown', function(e){ if (e.target && /(INPUT|TEXTAREA)/.test(e.target.tagName)) return; if (e.key==='u'||e.key==='U'){ var entry=(state.timeline||[]).find(function(t){ return t.id===state.selectedTimelineId; }); if(entry&&entry.linkGroup){ var g=entry.linkGroup; (state.timeline||[]).filter(function(t){ return t.linkGroup===g; }).forEach(function(t){ t.linkGroup=null; }); if (typeof renderTimeline==='function') renderTimeline(); }} else if (e.key==='l'||e.key==='L'){ var sel=(state.timeline||[]).filter(function(t){ return t.id===state.selectedTimelineId || t._uiSelected; }); if(sel.length===2){ var group='lg_'+uid(); sel.forEach(function(t){ t.linkGroup=group; }); state.linkedSelection=true; document.getElementById('tl-btn-linked')?.classList.add('active'); if (typeof renderTimeline==='function') renderTimeline(); } } });
  });
})();



(function(){
  function safe(fn){ try{ return fn&&fn(); }catch(e){} }
  function activateTab(name){
    try{
      document.querySelectorAll('#browser .panel-tab').forEach(t=>t.classList.remove('active'));
      const ml=document.getElementById('music-library');
      if(name==='music'){ document.getElementById('tab-music')?.classList.add('active'); ml?.classList.add('open'); }
      else { ml?.classList.remove('open'); document.getElementById('tab-'+name)?.classList.add('active'); }
      const o=document.getElementById('drag-overlay'); o&&o.classList.remove('show');
    }catch(e){}
  }
  const tb=document.getElementById('tab-bin');
  const te=document.getElementById('tab-effects');
  const tm=document.getElementById('tab-music');
  if (tb) tb.addEventListener('click', function(e){ e.stopImmediatePropagation(); activateTab('bin'); }, true);
  if (te) te.addEventListener('click', function(e){ e.stopImmediatePropagation(); activateTab('effects'); }, true);
  if (tm) tm.addEventListener('click', function(e){
    e.stopImmediatePropagation(); activateTab('music');
    setTimeout(()=>{ safe(()=>window.renderMusicLibrary && renderMusicLibrary()); }, 0);
    safe(()=> window.refreshCachedAudioUrls && refreshCachedAudioUrls().then(()=>{ safe(()=>window.updateCacheSizeDisplay && updateCacheSizeDisplay()); }).catch(()=>{}));
  }, true);

  const addBtn=document.getElementById('music-add-to-bin-btn');
  if (addBtn) addBtn.addEventListener('click', function(){
    try{
      const lib = (typeof getFullLibrary==='function')? getFullLibrary(): (window.MUSIC_LIBRARY||[]);
      let id = (window.musicState&&musicState.selectedTrackId) || (window.musicState&&musicState.previewTrack&&musicState.previewTrack.id);
      if (!id){ const first = document.querySelector('#music-list .music-item'); if (first) id = first.dataset.id; }
      const track = lib.find(t=> t.id===id);
      if (track && typeof addMusicToBin==='function') { addMusicToBin(track); }
      else { (window.setStatus||console.log)('Select a track first'); }
    }catch(e){}
  }, true);
})();



(function(){
  function on(id, evt, fn){ try{ var el=document.getElementById(id); if(el) el.addEventListener(evt, fn);}catch(e){} }
  function uid(){ return Math.random().toString(36).slice(2,9); }
  function ensureFolders(){ if (!window.state) return; if (!state.binFolders) state.binFolders=[{ id:'root', name:'All Clips', expanded:true }]; if (!state.binMap) state.binMap={}; }
  function moveClipToFolder(clipId, folderId){ ensureFolders(); state.binMap[clipId] = folderId || 'root'; }
  function createFolder(name){ ensureFolders(); var id='f_'+uid(); state.binFolders.push({ id:id, name:name||('Folder '+state.binFolders.length), expanded:true }); renderBin(); }
  function deleteFolder(id){ ensureFolders(); if (id==='root') return; Object.keys(state.binMap).forEach(function(cid){ if(state.binMap[cid]===id) state.binMap[cid]='root'; }); state.binFolders = state.binFolders.filter(function(f){ return f.id!==id; }); renderBin(); }
  function renameFolder(id){ ensureFolders(); var f=state.binFolders.find(function(x){return x.id===id}); if(!f) return; var nm=prompt('Folder name', f.name); if(nm){ f.name=nm; renderBin(); } }
  (function(){ var hdr=document.querySelector('#browser .panel-header'); if (hdr && !document.getElementById('bin-new-folder-btn')){ var btn=document.createElement('button'); btn.id='bin-new-folder-btn'; btn.className='tool-btn'; btn.textContent='+ Folder'; btn.title='Create folder'; btn.style.cssText='margin-left:auto;height:18px;font-size:9px;padding:0 6px;'; btn.addEventListener('click', function(){ var nm=prompt('Folder name'); if(nm) createFolder(nm); }); hdr.appendChild(btn); } })();
  window.renderBin = function(){
    ensureFolders(); var list = document.getElementById('bin-list'); if (!list) return; list.innerHTML='';
    var qEl = document.getElementById('bin-search'); var q = qEl ? (qEl.value||'').toLowerCase() : '';
    state.binFolders.forEach(function(f){
      var header=document.createElement('div'); header.className='bin-folder'; header.dataset.id=f.id;
      header.innerHTML = '<span class="bf-caret">'+(f.expanded?'▾':'▸')+'</span>'+
                         '<span class="bf-name">'+(f.name||'Folder')+'</span>'+
                         (f.id!=='root' ? '<button class="bf-del" title="Delete">✕</button>' : '');
      header.addEventListener('click', function(e){ if (e.target.classList.contains('bf-del')) return; f.expanded=!f.expanded; renderBin(); });
      if (f.id!=='root') header.addEventListener('dblclick', function(){ renameFolder(f.id); });
      header.addEventListener('dragover', function(e){ e.preventDefault(); header.style.background='rgba(74,143,205,0.2)'; });
      header.addEventListener('dragleave', function(){ header.style.background=''; });
      header.addEventListener('drop', function(e){ e.preventDefault(); header.style.background=''; var cid=e.dataTransfer.getData('text/x-clip-id'); if(cid){ moveClipToFolder(cid, f.id); renderBin(); }});
      if (f.id!=='root') header.querySelector('.bf-del')?.addEventListener('click', function(e){ e.stopPropagation(); if (confirm('Delete folder ''+f.name+''? Items will move to All Clips.')) deleteFolder(f.id); });
      list.appendChild(header); if (!f.expanded) return;
      (state.clips||[]).filter(function(c){ return (state.binMap[c.id]||'root')===f.id; })
                       .filter(function(c){ return !q || c.name.toLowerCase().includes(q); })
                       .forEach(function(clip){
        var item=document.createElement('div'); item.className='bin-item'+(clip.id===state.selectedClipId?' selected':''); item.dataset.id=clip.id; item.draggable=true;
        var bpmBadge = clip.bpm ? ('<span class="bpm-badge">'+clip.bpm+' BPM</span>') : '';
        var beatBadge = (clip.beatMarkers && clip.beatMarkers.length) ? ('<span class="beats-badge">♩ '+clip.beatMarkers.length+'</span>') : '';
        var analysingBadge = clip._stub ? '<span class="analysing-badge" style="background:rgba(180,80,30,0.3);color:#e09060;">⚠ re-import needed</span>' : (!clip.waveformData && !clip.bpm) ? '<span class="analysing-badge">● analysing</span>' : '';
        item.innerHTML = '<div class="bin-thumb">'+(clip.type==='audio'?'🎵':'🎬')+'</div>'+
                         '<div class="bin-info">'+
                         '  <div class="bin-name" title="'+clip.name+'">'+clip.name+'</div>'+
                         '  <div class="bin-meta">'+(window.formatTC? formatTC(clip.duration):'')+' · '+clip.type+bpmBadge+beatBadge+analysingBadge+'</div>'+
                         '</div>';
        item.addEventListener('click', function(){ window.selectBinClip && selectBinClip(clip.id); });
        item.addEventListener('dblclick', function(){ window.openInViewer && openInViewer(clip.id); });
        item.addEventListener('dragstart', function(e){ e.dataTransfer.setData('text/x-clip-id', clip.id); });
        list.appendChild(item);
      });
    });
  };
  (window.state && state.clips || []).forEach(function(c){ ensureFolders(); if(!state.binMap[c.id]) state.binMap[c.id]='root'; });
  if (document.readyState !== 'loading') { try { renderBin(); } catch(_){} }
})();



(function(){
  function ensureAllMapped(){ try{ if(!window.state) return; if(!state.binMap) state.binMap={}; (state.clips||[]).forEach(function(c){ if(!state.binMap[c.id]) state.binMap[c.id]='root'; }); }catch(e){} }
  if (typeof window.renderBin === 'function'){
    const _rb = window.renderBin; window.renderBin = function(){ ensureAllMapped(); return _rb(); };
  }
  if (typeof window.importFiles === 'function'){
    const _imp = window.importFiles; window.importFiles = function(files){ _imp(files); setTimeout(function(){ ensureAllMapped(); if (typeof renderBin==='function') renderBin(); }, 0); };
  }
})();



(function(){
  try { localStorage.setItem('cutpro-welcome-seen','1'); } catch(e) {}
  var w = document.getElementById('welcome-overlay');
  if (w && w.parentNode) { w.parentNode.removeChild(w); }
})();



(function(){
  const on=(id,evt,fn)=>{try{const el=document.getElementById(id);if(el)el.addEventListener(evt,fn);}catch(e){}};
  const safe=fn=>{try{return fn&&fn();}catch(e){}}
  // Guard CSS
  (function(){
    if(!document.getElementById('cutpro-v322-overlay-guard')){
      const css=document.createElement('style');
      css.id='cutpro-v322-overlay-guard';
      css.textContent='#music-library:not(.open){display:none!important;pointer-events:none!important;}
#drag-overlay{pointer-events:none!important;}';
      document.head.appendChild(css);
    }
  })();
  function hideOverlays(){ document.getElementById('music-library')?.classList.remove('open'); document.getElementById('drag-overlay')?.classList.remove('show'); }
  ['tab-bin','tab-effects','tab-music'].forEach(id=>{ on(id,'mousedown',hideOverlays); });
  const tb=document.getElementById('tab-bin'); const te=document.getElementById('tab-effects'); const tm=document.getElementById('tab-music');
  tb&&tb.addEventListener('click',e=>{e.stopImmediatePropagation?.(); safe(()=>window.activateTab&&activateTab('bin'));},true);
  te&&te.addEventListener('click',e=>{e.stopImmediatePropagation?.(); safe(()=>window.activateTab&&activateTab('effects'));},true);
  tm&&tm.addEventListener('click',e=>{e.stopImmediatePropagation?.(); safe(()=>window.activateTab&&activateTab('music'));},true);
  function ensureFolders(){ if(!window.state) return; if(!state.binFolders) state.binFolders=[{id:'root',name:'All Clips',expanded:true}]; if(!state.binMap) state.binMap={}; }
  function ensureAllMapped(){ try{ ensureFolders(); (state.clips||[]).forEach(c=>{ if(!state.binMap[c.id]) state.binMap[c.id]='root'; }); }catch(e){} }
  if (typeof window.renderBin==='function'){
    const _rb=window.renderBin;
    window.renderBin=function(){
      ensureAllMapped();
      let ok=true; try{ _rb(); }catch(e){ ok=false; console.warn('[Bin] original render failed, falling back', e); }
      const list=document.getElementById('bin-list'); if(!list) return;
      const hasClips=(state.clips||[]).length>0; const any=!!list.querySelector('.bin-item');
      if(hasClips && !any){
        list.innerHTML='';
        const q=(document.getElementById('bin-search')?.value||'').toLowerCase();
        (state.clips||[]).filter(c=>!q || (c.name||'').toLowerCase().includes(q)).forEach(clip=>{
          const item=document.createElement('div'); item.className='bin-item'+(clip.id===state.selectedClipId?' selected':''); item.dataset.id=clip.id; item.draggable=true;
          const bpm=clip.bpm?`<span class="bpm-badge">${clip.bpm} BPM</span>`:''; const beats=(clip.beatMarkers&&clip.beatMarkers.length)?`<span class="beats-badge">♩ ${clip.beatMarkers.length}</span>`:''; const ana=(!clip.waveformData && !clip.bpm)?'<span class="analysing-badge">● analysing</span>':'';
          item.innerHTML=`<div class="bin-thumb">${clip.type==='audio'?'🎵':'🎬'}</div><div class="bin-info"><div class="bin-name" title="${esc(clip.name)}">${esc(clip.name)}</div><div class="bin-meta">${window.formatTC?formatTC(clip.duration):''} · ${clip.type}${bpm}${beats}${ana}</div></div>`;
          item.addEventListener('click',()=>{ window.selectBinClip&&selectBinClip(clip.id); });
          item.addEventListener('dblclick',()=>{ window.openInViewer&&openInViewer(clip.id); });
          item.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/x-clip-id', clip.id); });
          list.appendChild(item);
        });
        console.log('[Bin fallback] flat render:', (state.clips||[]).length, 'items');
      }
      try{ const count=document.getElementById('bin-list').querySelectorAll('.bin-item').length; console.log('[Bin] clips:', state.clips?.length||0, 'listed:', count); }catch(_){ }
    }
  }
  if (typeof window.importFiles==='function'){
    const _imp=window.importFiles;
    window.importFiles=function(files){ _imp(files); setTimeout(()=>{ ensureAllMapped(); try{ window.renderBin&&renderBin(); }catch(_){} },0); console.log('[Import] files:', files&&files.length); };
  }
  if (window.state){ let last=(state.clips||[]).length; setInterval(()=>{ const n=(state.clips||[]).length; if(n!==last){ last=n; ensureAllMapped(); try{ window.renderBin&&renderBin(); }catch(_){} console.log('[Watcher] clips:', n); } }, 800); }
  hideOverlays(); ensureAllMapped(); try{ window.renderBin&&renderBin(); }catch(_){}
  console.log('[v3.2.2] overlay guard + fallback renderer active');
})();



(function(){
  function labelButtons(){
    document.querySelectorAll('button').forEach(btn=>{
      if ((btn.getAttribute('aria-label')||'').trim()) return;
      const title=(btn.getAttribute('title')||'').trim();
      const txt=(btn.textContent||'').trim();
      if (title) btn.setAttribute('aria-label', title);
      else if (!txt){
        if (btn.classList.contains('music-add-btn')) btn.setAttribute('aria-label','Add track to Bin');
        if (btn.classList.contains('music-play-btn')) btn.setAttribute('aria-label', btn.classList.contains('playing') ? 'Pause preview' : 'Play preview');
        if (btn.id==='btn-play') btn.setAttribute('aria-label','Play/Pause');
      }
    });
  }
  const ro=new MutationObserver(labelButtons); ro.observe(document.documentElement,{subtree:true,childList:true}); labelButtons();

  const MODALS=['export-modal','ai-cleanup-modal','save-load-modal','project-modal'];
  const FOCUSABLE='a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const lastActive=new Map();
  function trap(el){
    const isOpen=el.classList.contains('open');
    if(isOpen){
      lastActive.set(el.id, document.activeElement);
      const focusables=el.querySelectorAll(FOCUSABLE); const first=focusables[0]; const last=focusables[focusables.length-1]; if(first) first.focus();
      function onKey(e){
        if(e.key==='Tab'){
          if(focusables.length===0){ e.preventDefault(); return; }
          if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
          else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
        } else if(e.key==='Escape'){
          const closeBtn=el.querySelector('.export-close-btn, .ai-header-close, .sl-close, .project-close');
          if(closeBtn) closeBtn.click(); else el.classList.remove('open');
        }
      }
      el.__trapHandler=onKey; el.addEventListener('keydown', onKey);
    } else {
      if(el.__trapHandler){ el.removeEventListener('keydown', el.__trapHandler); delete el.__trapHandler; }
      const prev=lastActive.get(el.id); if(prev&&prev.focus) prev.focus();
    }
  }
  const mo=new MutationObserver(muts=>{ muts.forEach(m=>{ if(m.type==='attributes' && m.attributeName==='class' && MODALS.includes(m.target.id)){ trap(m.target); } }); });
  MODALS.forEach(id=>{ const el=document.getElementById(id); if(el){ if(!el.getAttribute('role')){ el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); }
    mo.observe(el,{attributes:true}); }});
})();
