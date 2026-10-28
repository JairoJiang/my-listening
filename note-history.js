"use strict";

let notesPageVersion = 0;
let notesPageMode = "active";
let notePlaybackRequest = 0;
let noteDetailTrigger = null;
let hoverNotes = false;
let hoverCloseTimer;
const hoveredNoteSurfaces = new Set();
document.querySelector(".playback-info").append(element("notes-open"));

function notePreview(content) {
  const text = content.trim().replace(/\s+/g, " ");
  if (typeof Intl.Segmenter === "function") {
    const segments = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)];
    const words = segments.filter((segment) => segment.isWordLike);
    if (words.length > 15) return text.slice(0, words[15].index).trim() + "…";
    return text;
  }
  const words = text.split(" ");
  return words.length > 15 ? words.slice(0, 15).join(" ") + "…" : text;
}

function materialName(key) {
  try { return JSON.parse(key.slice("my-listening:v1:".length))[0]; }
  catch { return "音频材料"; }
}

async function allNoteSessions() {
  const sessions = new Map();
  try {
    await libraryTransaction(["sessions"], "readonly", (transaction) => {
      const request = transaction.objectStore("sessions").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        sessions.set(cursor.key, cursor.value);
        cursor.continue();
      };
    });
  } catch {}
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("my-listening:v1:")) continue;
      try {
        const session = JSON.parse(localStorage.getItem(key));
        if (session && (!sessions.has(key) || (session.updatedAt || 0) >= (sessions.get(key).updatedAt || 0))) sessions.set(key, session);
      } catch {}
    }
  } catch {}
  if (ready && storageKey) sessions.set(storageKey, currentSession());
  return sessions;
}

async function writeNoteSession(key, session) {
  session.updatedAt = Date.now();
  let localSaved = false;
  let databaseSaved = false;
  try { localStorage.setItem(key, JSON.stringify(session)); localSaved = true; } catch {}
  try {
    await libraryTransaction(["sessions"], "readwrite", (transaction) => transaction.objectStore("sessions").put(session, key));
    databaseSaved = true;
  } catch {}
  if (!localSaved && !databaseSaved) throw new Error("保存失败，请检查浏览器存储空间后重试。");
}

async function changeNote(key, time, trashId = null) {
  const sessions = await allNoteSessions();
  let session = key === storageKey && ready ? currentSession() : sessions.get(key);
  if (!session) throw new Error("找不到该材料的记录。");
  session = { ...session, notes: { ...session.notes }, deletedNotes: cleanDeletedNotes(session.deletedNotes) };
  if (trashId) {
    const archived = session.deletedNotes.find((note) => note.id === trashId);
    if (!archived) throw new Error("这条笔记已超过 15 天或已经恢复。");
    if (session.notes[archived.time] && session.notes[archived.time] !== archived.content) throw new Error("该时间已有另一条笔记，请先处理现有笔记再恢复，避免覆盖。");
    session.notes[archived.time] = archived.content;
    session.deletedNotes = session.deletedNotes.filter((note) => note.id !== trashId);
  } else {
    if (!session.notes[time]) return;
    session.deletedNotes.push({ id: crypto.randomUUID(), time, content: session.notes[time], deletedAt: Date.now() });
    delete session.notes[time];
  }
  const oldNotes = notes;
  const oldDeletedNotes = deletedNotes;
  const current = key === storageKey && ready;
  if (current) { notes = session.notes; deletedNotes = session.deletedNotes; }
  try { await writeNoteSession(key, session); }
  catch (error) {
    if (current && key === storageKey) { notes = oldNotes; deletedNotes = oldDeletedNotes; }
    throw error;
  }
  if (key === storageKey && ready) renderMarks();
}

async function jumpToNote(key, time) {
  const request = ++notePlaybackRequest;
  if (key !== storageKey || !ready) {
    await selectMaterial(key);
    if (request !== notePlaybackRequest) return;
    if (!ready) await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", loaded);
        audio.removeEventListener("error", failed);
        error ? reject(error) : resolve();
      };
      const loaded = () => finish(ready && storageKey === key ? null : new Error("无法读取音频。"));
      const failed = () => finish(new Error("无法打开音频，请重新导入原材料。"));
      const timer = setTimeout(() => failed(), 15000);
      audio.addEventListener("loadedmetadata", loaded);
      audio.addEventListener("error", failed);
    });
  }
  if (request !== notePlaybackRequest) return;
  if (key !== storageKey || !ready) throw new Error("音频尚未准备好，请重试。");
  if (time > audio.duration) throw new Error("笔记时间超出这份音频的时长，请检查材料。");
  seek(time);
  selectedMark = marks.includes(time) ? time : null;
  updateSelection();
  try { await audio.play(); }
  catch { throw new Error("已跳到笔记位置，浏览器暂未允许自动播放，请点底部播放键。历史笔记窗口会保持打开。"); }
}

async function renderNotesPage() {
  const version = ++notesPageVersion;
  const trash = notesPageMode === "trash";
  element("notes-page-title").textContent = trash ? "历史笔记 · 已删除" : "历史笔记";
  element("notes-page-message").textContent = "";
  element("notes-list").replaceChildren();
  const sessions = await allNoteSessions();
  if (version !== notesPageVersion || element("notes-page").hidden) return;
  const entries = [];
  for (const [key, session] of sessions) {
    if (trash) cleanDeletedNotes(session.deletedNotes).forEach((note) => entries.push({ ...note, key, orphan: !session.marks?.includes(note.time) }));
    else Object.entries(session.notes || {}).forEach(([time, content]) => {
      if (typeof content === "string" && content.trim() && Number.isFinite(Number(time)) && Number(time) >= 0) entries.push({ key, time: Number(time), content, orphan: !session.marks?.includes(Number(time)), updatedAt: session.updatedAt || 0 });
    });
  }
  entries.sort((first, second) => (second.deletedAt || second.updatedAt || 0) - (first.deletedAt || first.updatedAt || 0) || first.time - second.time);
  element("notes-page-message").textContent = "";
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "note-history-row";
    row.classList.toggle("orphan-note", entry.orphan);
    row.dataset.key = entry.key;
    row.dataset.time = String(entry.time);
    const preview = document.createElement("button");
    preview.className = "note-preview";
    const timestamp = document.createElement("span");
    timestamp.className = "note-timestamp";
    timestamp.textContent = formatTime(entry.time);
    const snippet = document.createElement("span");
    snippet.className = "note-snippet";
    snippet.textContent = notePreview(entry.content);
    preview.append(timestamp, snippet);
    preview.setAttribute("aria-label", `${materialName(entry.key)}，${formatTime(entry.time)}，${entry.content}`);
    preview.addEventListener("click", async () => {
      preview.disabled = true;
      try { await jumpToNote(entry.key, entry.time); }
      catch (error) { element("notes-page-message").textContent = error.message || "无法打开材料，请重新导入原音频。"; }
      finally { preview.disabled = false; }
    });
    const expand = document.createElement("button");
    expand.className = "note-history-action";
    expand.textContent = "展开";
    expand.addEventListener("click", () => {
      noteDetailTrigger = expand;
      element("note-detail-content").textContent = entry.content;
      element("note-detail-content").style.color = row.classList.contains("orphan-note") ? "#c03d44" : "";
      element("note-detail-window").hidden = false;
      updateNotesBounds();
      element("note-detail-close").focus();
    });
    const action = document.createElement("button");
    action.className = "note-history-action";
    action.textContent = trash ? "恢复" : "删除";
    action.addEventListener("click", async () => {
      action.disabled = true;
      try { await changeNote(entry.key, entry.time, trash ? entry.id : null); await renderNotesPage(); }
      catch (error) { element("notes-page-message").textContent = error.message; action.disabled = false; }
    });
    row.append(preview, action, expand);
    element("notes-list").append(row);
  });
}

function openNotesWindow(mode = "active", focus = true) {
  if (!element("notes-page").hidden && notesPageMode === mode) return;
  checkpoint();
  notesPageMode = mode;
  element("notes-page").hidden = false;
  updateNotesBounds();
  renderNotesPage();
  if (focus) element("notes-back").focus();
}

function closeNotesPage(focus = true) {
  clearTimeout(hoverCloseTimer);
  hoverNotes = false;
  hoveredNoteSurfaces.clear();
  if (["#notes", "#deleted-notes"].includes(window.location.hash)) history.replaceState(null, "", window.location.pathname + window.location.search);
  element("notes-page").hidden = true;
  element("note-detail-window").hidden = true;
  notesPageVersion += 1;
  if (focus) element("notes-open").focus();
}

function refreshNotePresence() {
  element("notes-list").querySelectorAll(".note-history-row").forEach((row) => {
    if (row.dataset.key === storageKey) row.classList.toggle("orphan-note", !marks.includes(Number(row.dataset.time)));
  });
}

function syncNotesRoute() {
  if (window.location.hash === "#notes") openNotesWindow();
  else if (window.location.hash === "#deleted-notes") openNotesWindow("trash");
}

function supportsNotesHover() {
  return document.documentElement.dataset.layout === "desktop" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

element("notes-open").addEventListener("click", () => { hoverNotes = supportsNotesHover(); openNotesWindow(); });
element("notes-open").addEventListener("mouseenter", () => {
  if (supportsNotesHover()) { hoverNotes = true; openNotesWindow("active", false); }
});
for (const id of ["notes-open", "notes-page", "note-detail-window"]) {
  element(id).addEventListener("mouseenter", () => { hoveredNoteSurfaces.add(id); clearTimeout(hoverCloseTimer); });
  element(id).addEventListener("mouseleave", () => {
    hoveredNoteSurfaces.delete(id);
    clearTimeout(hoverCloseTimer);
    if (hoverNotes) hoverCloseTimer = setTimeout(() => {
      if (hoverNotes && hoveredNoteSurfaces.size === 0) closeNotesPage(false);
    }, 250);
  });
}
element("note-trash-open").addEventListener("click", () => { hoverNotes = false; clearTimeout(hoverCloseTimer); element("menu").open = false; openNotesWindow("trash"); });
element("notes-back").addEventListener("click", () => closeNotesPage());
element("note-detail-close").addEventListener("click", () => {
  element("note-detail-window").hidden = true;
  hoveredNoteSurfaces.delete("note-detail-window");
  if (noteDetailTrigger?.isConnected) noteDetailTrigger.focus();
  else element("notes-back").focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
  if (!element("note-detail-window").hidden) { event.preventDefault(); element("note-detail-close").click(); }
  else if (!element("notes-page").hidden) { event.preventDefault(); closeNotesPage(); }
});
window.addEventListener("hashchange", syncNotesRoute);

function updateNotesBounds() {
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
  const titleBottom = document.querySelector(".topbar").getBoundingClientRect().bottom;
  const controlsTop = document.querySelector(".player-dock").getBoundingClientRect().top;
  const top = Math.max(viewportTop + 12, titleBottom + 8);
  const bottom = Math.min(viewportBottom - 12, controlsTop - 12);
  document.documentElement.style.setProperty("--notes-bottom", `${window.innerHeight - bottom}px`);
  document.documentElement.style.setProperty("--notes-max-height", `${Math.max(0, bottom - top)}px`);
}
if (typeof ResizeObserver !== "undefined") {
  const notesBoundsObserver = new ResizeObserver(updateNotesBounds);
  notesBoundsObserver.observe(document.querySelector(".topbar"));
  notesBoundsObserver.observe(document.querySelector(".player-dock"));
}
window.addEventListener("resize", updateNotesBounds);
window.addEventListener("scroll", updateNotesBounds, { passive: true });
window.visualViewport?.addEventListener("resize", updateNotesBounds);
window.visualViewport?.addEventListener("scroll", updateNotesBounds);

async function purgeExpiredNotes() {
  const sessions = await allNoteSessions();
  for (const [key, saved] of sessions) {
    const session = key === storageKey && ready ? currentSession() : saved;
    const retained = cleanDeletedNotes(session.deletedNotes);
    if (Array.isArray(saved.deletedNotes) && retained.length !== saved.deletedNotes.length) {
      if (key === storageKey && ready) deletedNotes = retained;
      try { await writeNoteSession(key, { ...session, deletedNotes: retained }); }
      catch { libraryWarning("过期笔记暂时无法从存储清除，请检查浏览器存储后重新打开。"); }
    }
  }
}
syncNotesRoute();
purgeExpiredNotes();
setInterval(purgeExpiredNotes, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { purgeExpiredNotes(); if (!element("notes-page").hidden) renderNotesPage(); } });
