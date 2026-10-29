"use strict";

let pendingBackup = null;
let backupDownloadURL = "";
let backupBusy = false;
const backupPrefix = "my-listening:v1:";

function backupMaterial(key) {
  if (typeof key !== "string" || !key.startsWith(backupPrefix)) throw new Error("备份材料标识无效。");
  const parts = JSON.parse(key.slice(backupPrefix.length));
  if (!Array.isArray(parts) || parts.length !== 3 || typeof parts[0] !== "string" || !parts[0] || !Number.isSafeInteger(parts[1]) || parts[1] < 0 || !Number.isSafeInteger(parts[2]) || parts[2] < 0) throw new Error("备份材料信息无效。");
  return { key, name: parts[0], size: parts[1], lastModified: parts[2] };
}

function backupTime(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

function normalizeBackupSession(value) {
  const source = Array.isArray(value) ? { marks: value } : value;
  if (!source || typeof source !== "object" || !Array.isArray(source.marks)) throw new Error("备份中的标记数据无效。");
  if (!source.marks.every(backupTime)) throw new Error("备份包含无效时间点。");
  const normalizedNotes = {};
  if (source.notes !== undefined && (!source.notes || typeof source.notes !== "object" || Array.isArray(source.notes))) throw new Error("备份中的笔记数据无效。");
  for (const [time, content] of Object.entries(source.notes || {})) {
    if (!time.trim() || !backupTime(Number(time)) || typeof content !== "string") throw new Error("备份中的笔记时间或内容无效。");
    normalizedNotes[String(Number(time))] = content;
  }
  const trash = source.deletedNotes || [];
  if (!Array.isArray(trash) || !trash.every((note) => note && typeof note.id === "string" && note.id.length > 0 && note.id.length <= 512 && typeof note.content === "string" && backupTime(note.time) && backupTime(note.deletedAt) && note.deletedAt <= Date.now() + 60000)) throw new Error("备份中的回收笔记无效。");
  if (source.position !== undefined && !backupTime(source.position)) throw new Error("备份中的播放进度无效。");
  if (source.rate !== undefined && ![0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(source.rate)) throw new Error("备份中的倍速无效。");
  if (source.rowLength !== undefined && ![30, 60, 120].includes(source.rowLength)) throw new Error("备份中的行时长无效。");
  return { marks: [...new Set(source.marks)].sort((first, second) => first - second), notes: normalizedNotes, deletedNotes: cleanDeletedNotes(trash).map((note) => ({ id: note.id, time: note.time, content: note.content, deletedAt: note.deletedAt })), position: source.position || 0, rate: source.rate || 1, rowLength: source.rowLength || 60, updatedAt: backupTime(source.updatedAt) ? source.updatedAt : 0 };
}

function validateBackup(data) {
  if (!data || data.app !== "My Listening" || data.version !== 1 || data.mediaIncluded !== false || !Array.isArray(data.materials) || data.materials.length > 5000) throw new Error("不是支持的 My Listening 备份文件，请选择本应用导出的 JSON 文件。");
  const seen = new Set();
  return data.materials.map((record) => {
    const material = backupMaterial(record?.key);
    if (seen.has(material.key)) throw new Error("备份含有重复材料，请检查文件。");
    seen.add(material.key);
    return { key: material.key, session: normalizeBackupSession(record.session) };
  });
}

async function collectBackupSessions() {
  const sessions = new Map();
  await libraryTransaction(["sessions", "history"], "readonly", (transaction) => {
    for (const store of ["sessions", "history"]) {
      const request = transaction.objectStore(store).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (store === "sessions") sessions.set(cursor.key, cursor.value);
        else if (!sessions.has(cursor.key)) sessions.set(cursor.key, { marks: [], notes: {} });
        cursor.continue();
      };
    }
  });
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(backupPrefix)) continue;
    const saved = JSON.parse(localStorage.getItem(key));
    if (!sessions.has(key) || (saved?.updatedAt || 0) >= (sessions.get(key)?.updatedAt || 0)) sessions.set(key, saved);
  }
  if (ready && storageKey) sessions.set(storageKey, currentSession());
  return sessions;
}

function mergeBackupSession(existing, incoming) {
  if (!existing) return incoming;
  const current = normalizeBackupSession(existing);
  const mergedNotes = { ...current.notes };
  for (const [time, content] of Object.entries(incoming.notes)) {
    if (!mergedNotes[time]) mergedNotes[time] = content;
    else if (mergedNotes[time] !== content) {
      const addition = `\n\n——恢复的备份笔记——\n${content}`;
      if (!mergedNotes[time].includes(addition)) mergedNotes[time] += addition;
    }
  }
  const trash = new Map();
  for (const note of [...current.deletedNotes, ...incoming.deletedNotes]) {
    const signature = JSON.stringify([note.time, note.content, note.deletedAt]);
    if (!trash.has(signature)) trash.set(signature, { ...note });
  }
  const usedIds = new Set();
  for (const note of trash.values()) {
    if (usedIds.has(note.id)) note.id = crypto.randomUUID();
    usedIds.add(note.id);
  }
  return { ...current, marks: [...new Set([...current.marks, ...incoming.marks])].sort((first, second) => first - second), notes: mergedNotes, deletedNotes: [...trash.values()] };
}

function showBackup(title) {
  element("menu").open = false;
  element("backup-title").textContent = title;
  element("backup-download").hidden = true;
  element("backup-confirm").hidden = true;
  pendingBackup = null;
  if (!element("backup-dialog").open) element("backup-dialog").showModal();
}

element("backup-export").addEventListener("click", async () => {
  if (backupBusy) return;
  backupBusy = true;
  audio.pause();
  checkpoint();
  showBackup("导出备份");
  element("backup-message").textContent = "正在汇总所有材料的记录…";
  try {
    const sessions = await collectBackupSessions();
    const materials = [...sessions].map(([key, session]) => { backupMaterial(key); return { key, session: normalizeBackupSession(session) }; });
    const payload = { app: "My Listening", version: 1, exportedAt: new Date().toISOString(), mediaIncluded: false, materials };
    if (backupDownloadURL) URL.revokeObjectURL(backupDownloadURL);
    backupDownloadURL = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const download = element("backup-download");
    download.href = backupDownloadURL;
    download.download = `my-listening-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    download.hidden = false;
    element("backup-message").textContent = `已整理 ${materials.length} 份材料的标记、笔记、播放进度和未过期回收笔记。请点击下载并保存到“文件”、电脑或网盘。不包含音视频原文件，请另外备份；确认文件已保存后再清理网站数据。`;
  } catch {
    element("backup-message").textContent = "无法完整读取本地记录，未生成备份。请关闭其他窗口、确认浏览器存储可用后重试，暂时不要清理网站数据。";
  } finally { backupBusy = false; }
});

element("backup-restore").addEventListener("click", () => {
  if (backupBusy) return;
  element("menu").open = false;
  element("backup-file").click();
});
element("backup-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || backupBusy) return;
  backupBusy = true;
  audio.pause();
  checkpoint();
  showBackup("恢复备份");
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("备份文件超过 25 MB，请选择仅包含记录的备份文件。");
    pendingBackup = validateBackup(JSON.parse(await file.text()));
    const markCount = pendingBackup.reduce((total, record) => total + record.session.marks.length, 0);
    const noteCount = pendingBackup.reduce((total, record) => total + Object.keys(record.session.notes).length, 0);
    element("backup-message").textContent = `${pendingBackup.length} 份材料、${markCount} 个标记、${noteCount} 条笔记。恢复会合并标记，相同位置的不同笔记会追加保留；已有材料保留当前播放进度，新材料恢复备份进度。回收笔记沿用原删除日期。音视频需另外导入原文件。`;
    element("backup-confirm").hidden = pendingBackup.length === 0;
  } catch (error) {
    pendingBackup = null;
    element("backup-message").textContent = `无法恢复：${error.message} 当前记录未改动。`;
  } finally { backupBusy = false; }
});

element("backup-confirm").addEventListener("click", async () => {
  if (!pendingBackup || backupBusy) return;
  backupBusy = true;
  const wasReady = ready;
  audio.pause();
  checkpoint();
  element("backup-confirm").disabled = true;
  element("backup-close").disabled = true;
  try {
    const existing = await collectBackupSessions();
    const merged = pendingBackup.map(({ key, session }) => {
      const result = mergeBackupSession(existing.get(key), session);
      result.updatedAt = Math.max(Date.now(), (existing.get(key)?.updatedAt || 0) + 1);
      return { key, session: result, material: backupMaterial(key) };
    });
    setReady(false);
    await libraryTransaction(["sessions", "history"], "readwrite", (transaction) => {
      for (const record of merged) {
        transaction.objectStore("sessions").put(record.session, record.key);
        const historyStore = transaction.objectStore("history");
        const request = historyStore.get(record.key);
        request.onsuccess = () => { if (!request.result) historyStore.put({ ...record.material, openedAt: Date.now() }, record.key); };
      }
    });
    let mirrorFailed = false;
    for (const record of merged) {
      try { localStorage.setItem(record.key, JSON.stringify(record.session)); } catch { mirrorFailed = true; }
    }
    setReady(wasReady);
    const current = merged.find((record) => record.key === storageKey);
    if (current && wasReady) { pendingSession = current.session; restoreMarks(); }
    if (!element("notes-page").hidden) renderNotesPage();
    pendingBackup = null;
    element("backup-confirm").hidden = true;
    element("backup-message").textContent = `已恢复 ${merged.length} 份材料的记录。若原音视频不在本机，请重新导入原文件，保持文件名、大小和修改时间一致即可匹配。${mirrorFailed ? "数据库已保存，但 localStorage 副本未写入，请保留备份文件。" : "请检查记录后再清理网站数据，并保留备份文件。"}`;
  } catch {
    setReady(wasReady);
    element("backup-message").textContent = "恢复未完成，可能是浏览器存储不可用或空间不足。请保留备份文件并重试。";
  } finally {
    backupBusy = false;
    element("backup-confirm").disabled = false;
    element("backup-close").disabled = false;
  }
});
element("backup-close").addEventListener("click", () => { if (!backupBusy) element("backup-dialog").close(); });
element("backup-dialog").addEventListener("cancel", (event) => { if (backupBusy) event.preventDefault(); });
