"use strict";

const element = (id) => document.getElementById(id);
const audio = element("audio");
let timelineRows = [];
let selectedMark = null;
let marks = [];
let notes = {};
let editingMark = null;
let storageKey = "";
let objectURL = "";
let ready = false;
let loadVersion = 0;
let pendingSession = null;
let lastCheckpoint = 0;
const tolerance = 0.15;
const markerLaneHeight = document.documentElement.dataset.layout === "mobile" ? 44 : 24;

function formatTime(seconds) {
  const total = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${String(minutes).padStart(2, "0")}:${remainder}`;
}

function announce(message, visible = false) {
  element("status").textContent = message;
  element("status").className = visible ? "notice" : "sr-only";
}

element("import").addEventListener("click", () => {
  element("file").click();
  element("menu").open = false;
});
document.addEventListener("click", (event) => {
  if (!element("menu").contains(event.target)) element("menu").open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && element("menu").open) {
    element("menu").open = false;
    element("menu").querySelector("summary").focus();
  }
});
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--dock-height", `${entry.target.getBoundingClientRect().height}px`);
  }).observe(document.querySelector(".player-dock"));
}

function setReady(value) {
  ready = value;
  for (const id of ["play", "add", "previous", "next", "quick-previous", "quick-next"]) element(id).disabled = !value;
  element("delete-mark").disabled = !value;
}

function saveMarks() {
  const session = currentSession();
  if (typeof persistSession === "function") persistSession(storageKey, session);
  try {
    localStorage.setItem(storageKey, JSON.stringify(session));
    element("storage").className = "sr-only";
    element("storage").textContent = "标记和笔记已保存在此浏览器。";
    return true;
  } catch {
    element("storage").className = "notice";
    element("storage").textContent = "浏览器无法保存标记；本次仍可使用，关闭页面后可能丢失。";
    return false;
  }
}

function restoreMarks() {
  marks = [];
  notes = {};
  element("storage").className = "sr-only";
  try {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch {}
    const saved = (pendingSession?.updatedAt || 0) > (local?.updatedAt || 0) ? pendingSession : (local || pendingSession || []);
    const savedMarks = Array.isArray(saved) ? saved : saved?.marks;
    if (Array.isArray(savedMarks)) marks = [...new Set(savedMarks.filter((time) => typeof time === "number" && Number.isFinite(time) && time >= 0 && time <= audio.duration))].sort((first, second) => first - second);
    marks.forEach((time) => {
      if (typeof saved?.notes?.[time] === "string") notes[time] = saved.notes[time];
    });
    const position = Number.isFinite(saved.position) ? saved.position : 0;
    audio.currentTime = Math.max(0, Math.min(position, audio.duration));
    if ([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(saved.rate)) {
      element("speed").value = String(saved.rate);
      audio.playbackRate = saved.rate;
    }
    if ([30, 60, 120].includes(saved.rowLength)) element("row-length").value = String(saved.rowLength);
    element("storage").textContent = "已恢复播放进度、标记和笔记。";
  } catch {
    element("storage").className = "notice";
    element("storage").textContent = "无法读取已保存标记，本次可以重新添加。";
  }
  renderMarks();
  pendingSession = null;
}

function currentSession() {
  return { marks: [...marks], notes: { ...notes }, position: audio.currentTime || 0, rate: Number(element("speed").value), rowLength: Number(element("row-length").value), updatedAt: Date.now() };
}

function checkpoint() {
  if (!ready || !storageKey) return;
  const session = currentSession();
  try { localStorage.setItem(storageKey, JSON.stringify(session)); } catch {}
  if (typeof persistSession === "function") persistSession(storageKey, session);
}

function seek(time) {
  if (!ready) return;
  audio.currentTime = Math.min(audio.duration, Math.max(0, time));
  updateProgress();
}

function renderMarks() {
  element("timeline").replaceChildren();
  timelineRows = [];
  element("empty").hidden = ready;
  element("count").textContent = `${marks.length} 个标记`;
  updateSelection();
  if (!ready) return;
  const span = Number(element("row-length").value);
  const rowCount = Math.ceil(audio.duration / span);
  for (let index = 0; index < rowCount; index += 1) {
    const start = index * span;
    const end = Math.min(start + span, audio.duration);
    const row = document.createElement("div");
    row.className = "timeline-row";
    const labels = document.createElement("div");
    labels.className = "times";
    const from = document.createElement("span");
    const to = document.createElement("span");
    from.textContent = formatTime(start);
    to.textContent = formatTime(end);
    labels.append(from, to);
    const markers = document.createElement("div");
    markers.className = "marker-track";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "segment";
    slider.min = String(start);
    slider.max = String(end);
    slider.step = "0.01";
    slider.setAttribute("aria-label", `第 ${index + 1} 行，${formatTime(start)} 至 ${formatTime(end)}`);
    slider.addEventListener("input", () => seek(Number(slider.value)));
    row.append(labels, markers, slider);
    element("timeline").append(row);
    const laneEnds = [];
    marks.filter((time) => time >= start && (time < end || (index === rowCount - 1 && time === end))).forEach((time) => {
      const position = (time - start) / (end - start);
      const pixel = position * Math.max(1, markers.clientWidth);
      let lane = laneEnds.findIndex((last) => pixel - last >= 44);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = pixel;
      const marker = document.createElement("button");
      marker.className = "marker";
      marker.textContent = "▼";
      marker.style.left = `${position * 100}%`;
      marker.style.bottom = `${lane * markerLaneHeight}px`;
      marker.dataset.time = String(time);
      marker.setAttribute("aria-label", `跳转并打开 ${formatTime(time)} 的笔记`);
      marker.title = `${formatTime(time)} · ${notes[time] ? "查看笔记" : "添加笔记"}`;
      marker.addEventListener("click", () => {
        selectedMark = time;
        seek(time);
        updateSelection();
        openNote(time);
      });
      markers.append(marker);
    });
    markers.style.height = `${laneEnds.length * markerLaneHeight}px`;
    timelineRows.push({ row, slider, start, end });
  }
  updateSelection();
  updateProgress();
}

function updateSelection() {
  if (!marks.includes(selectedMark)) selectedMark = null;
  element("delete-mark").disabled = !ready;
  element("selection").textContent = selectedMark === null ? "点击黄色 ▼ 可跳转。" : `已跳转到 ${formatTime(selectedMark)} 的标记。`;
  element("timeline").querySelectorAll(".marker").forEach((marker) => {
    marker.setAttribute("aria-pressed", String(Number(marker.dataset.time) === selectedMark));
  });
}

function updateProgress() {
  element("current").textContent = formatTime(audio.currentTime);
  timelineRows.forEach(({ row, slider, start, end }, index) => {
    const time = audio.currentTime || 0;
    slider.value = String(Math.min(end, Math.max(start, time)));
    slider.style.setProperty("--played", `${(Number(slider.value) - start) / (end - start) * 100}%`);
    slider.setAttribute("aria-valuetext", formatTime(Number(slider.value)));
    row.classList.toggle("active", time >= start && time < end);
  });
}

function jumpMark(direction, steps = 1) {
  if (!ready) return;
  const time = audio.currentTime;
  const candidates = direction < 0
    ? marks.slice().reverse().filter((mark) => mark < time - tolerance)
    : marks.filter((mark) => mark > time + tolerance);
  const target = candidates[steps - 1];
  if (target === undefined) announce(direction < 0 ? "前面没有更多标记了。" : "后面没有更多标记了。");
  else { seek(target); announce(`已跳转到 ${formatTime(target)}。`); }
}

element("file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  importMaterial(file);
  event.target.value = "";
});

function loadMaterial(file, key, session = null) {
  checkpoint();
  loadVersion += 1;
  audio.pause();
  setReady(false);
  audio.removeAttribute("src");
  audio.load();
  if (objectURL) URL.revokeObjectURL(objectURL);
  marks = [];
  notes = {};
  editingMark = null;
  if (element("note-dialog").open) element("note-dialog").close();
  renderMarks();
  element("current").textContent = "00:00";
  element("duration").textContent = "00:00";
  element("filename").textContent = file.name;
  storageKey = key;
  pendingSession = session;
  objectURL = URL.createObjectURL(file);
  audio.src = objectURL;
  audio.load();
  announce("正在读取音频…");
}

audio.addEventListener("loadedmetadata", () => {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    announce("无法读取音频时长，请尝试 MP3 或 M4A 文件。", true);
    return;
  }
  setReady(true);
  audio.playbackRate = Number(element("speed").value);
  element("duration").textContent = formatTime(audio.duration);
  restoreMarks();
  announce(marks.length ? `已恢复 ${marks.length} 个标记，点击播放开始。` : "准备好了，点击播放开始。");
});
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src")) return;
  setReady(false);
  renderMarks();
  announce("无法播放此音频，请尝试 MP3 / M4A，或确认文件已下载到设备。", true);
});
audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("timeupdate", () => {
  if (Date.now() - lastCheckpoint >= 1000) { lastCheckpoint = Date.now(); checkpoint(); }
});
for (const name of ["pause", "seeked", "ratechange", "ended"]) audio.addEventListener(name, checkpoint);
document.addEventListener("visibilitychange", () => { if (document.hidden) checkpoint(); });
window.addEventListener("pagehide", checkpoint);
for (const name of ["play", "pause", "ended", "emptied"]) audio.addEventListener(name, () => {
  element("play-shape").setAttribute("d", audio.paused ? "M9 6 30 16 9 26z" : "M7 6h6v20H7zM19 6h6v20h-6z");
  element("play").setAttribute("aria-label", audio.paused ? "播放" : "暂停");
});
element("play").addEventListener("click", async () => {
  if (!ready) return;
  if (!audio.paused) { audio.pause(); return; }
  const version = loadVersion;
  try { await audio.play(); if (version === loadVersion) announce("正在播放。"); }
  catch { if (version === loadVersion) announce("播放未能开始，请再点一次播放，或尝试其他音频。", true); }
});
element("speed").addEventListener("change", () => { audio.playbackRate = Number(element("speed").value); });
element("row-length").addEventListener("change", () => { renderMarks(); checkpoint(); });
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderMarks, 150);
});
function deleteMark(direction) {
  if (!ready) return;
  const time = direction < 0
    ? marks.slice().reverse().find((mark) => mark <= audio.currentTime)
    : marks.find((mark) => mark > audio.currentTime);
  if (time === undefined) {
    announce(direction < 0 ? "当前位置及之前没有标记。" : "播放位置之后没有标记。");
    return;
  }
  marks = marks.filter((mark) => mark !== time);
  delete notes[time];
  if (selectedMark === time) selectedMark = null;
  saveMarks();
  renderMarks();
  announce(`已删除 ${formatTime(time)} 的标记。`);
}
element("delete-mark").addEventListener("click", () => deleteMark(-1));
element("add").addEventListener("click", () => {
  if (!ready) return;
  const time = audio.currentTime;
  if (marks.some((mark) => Math.abs(mark - time) < tolerance)) { announce("这个位置已经有标记了。"); return; }
  marks.push(time);
  selectedMark = time;
  marks.sort((first, second) => first - second);
  saveMarks();
  renderMarks();
  announce(`已添加 ${formatTime(time)} 的标记。`);
});
element("previous").addEventListener("click", () => jumpMark(-1));
element("next").addEventListener("click", () => jumpMark(1));
element("quick-previous").addEventListener("click", () => jumpMark(-1, 2));
element("quick-next").addEventListener("click", () => jumpMark(1, 2));

function openNote(time) {
  audio.pause();
  editingMark = time;
  element("note-title").textContent = `${formatTime(time)} · 笔记`;
  element("note-text").value = notes[time] || "";
  element("note-message").textContent = "";
  element("note-dialog").showModal();
  element("note-text").focus();
}

element("note-save").addEventListener("click", () => {
  if (editingMark === null || !marks.includes(editingMark)) return;
  const content = element("note-text").value;
  if (content) notes[editingMark] = content;
  else delete notes[editingMark];
  if (saveMarks()) {
    element("note-dialog").close();
    renderMarks();
    element("play").focus();
  } else {
    element("note-message").textContent = "笔记暂存在本次页面，但无法保存到浏览器。请复制备份，或再次尝试保存。";
  }
});
element("note-close").addEventListener("click", () => element("note-dialog").close());
element("note-dialog").addEventListener("close", () => {
  editingMark = null;
  element("play").focus();
});
