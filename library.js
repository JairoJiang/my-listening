"use strict";

let materialRequest = 0;
let libraryDatabase;

function openLibrary() {
  if (libraryDatabase) return libraryDatabase;
  libraryDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open("my-listening-library", 1);
    request.onupgradeneeded = () => {
      for (const name of ["files", "history", "sessions", "preferences"]) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); libraryDatabase = null; };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("材料库被其他窗口占用"));
  });
  libraryDatabase.catch(() => { libraryDatabase = null; });
  return libraryDatabase;
}

async function libraryTransaction(stores, mode, operation) {
  const database = await openLibrary();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let result;
    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("保存已中止"));
    result = operation(transaction);
  });
}

function readLibrary(store, key) {
  return libraryTransaction([store], "readonly", (transaction) => transaction.objectStore(store).get(key));
}

function libraryWarning(message) {
  element("library-status").textContent = message;
  element("library-status").className = "notice";
}

function persistSession(key, session) {
  if (!key) return;
  libraryTransaction(["sessions"], "readwrite", (transaction) => transaction.objectStore("sessions").put(session, key))
    .catch(() => libraryWarning("播放记录未能写入材料库，请不要清理网站数据；重要笔记请另行备份。"));
}

async function rememberMaterial(file, key) {
  await libraryTransaction(["files", "history", "preferences"], "readwrite", (transaction) => {
    transaction.objectStore("files").put(file, key);
    transaction.objectStore("history").put({ key, name: file.name, size: file.size, lastModified: file.lastModified, openedAt: Date.now() }, key);
    transaction.objectStore("preferences").put(key, "lastMaterial");
  });
}

async function importMaterial(file) {
  const request = ++materialRequest;
  checkpoint();
  const key = `my-listening:v1:${JSON.stringify([file.name, file.size, file.lastModified])}`;
  let session = null;
  try { session = await readLibrary("sessions", key); } catch {}
  if (request !== materialRequest) return;
  loadMaterial(file, key, session);
  try {
    await rememberMaterial(file, key);
    if (request === materialRequest) {
      element("library-status").textContent = "材料已保存在本机，下次打开会恢复。";
      element("library-status").className = "sr-only";
    }
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch {
    if (request === materialRequest) libraryWarning("音频未能保存在本机（可能空间不足或处于隐私浏览）。本次可以播放，但下次需重新导入。");
  }
}

async function selectMaterial(key, request = ++materialRequest) {
  checkpoint();
  const [file, session, info] = await Promise.all([readLibrary("files", key), readLibrary("sessions", key), readLibrary("history", key)]);
  if (request !== materialRequest) return;
  if (!file || !info) throw new Error("本地音频已不可用，请重新导入。");
  const restoredFile = new File([file], info.name, { type: file.type, lastModified: info.lastModified });
  loadMaterial(restoredFile, key, session);
  await libraryTransaction(["history", "preferences"], "readwrite", (transaction) => {
    transaction.objectStore("history").put({ ...info, openedAt: Date.now() }, key);
    transaction.objectStore("preferences").put(key, "lastMaterial");
  });
}

element("library-open").addEventListener("click", async () => {
  element("menu").open = false;
  element("library-dialog").showModal();
  element("library-list").replaceChildren();
  element("library-message").textContent = "正在读取…";
  try {
    const materials = await libraryTransaction(["history"], "readonly", (transaction) => transaction.objectStore("history").getAll());
    element("library-message").textContent = materials.length ? "保存在当前设备，点击继续收听。" : "还没有材料，请先导入音频。";
    materials.sort((first, second) => second.openedAt - first.openedAt).forEach((info) => {
      const button = document.createElement("button");
      button.className = "library-item";
      button.textContent = info.name;
      const detail = document.createElement("small");
      detail.textContent = `${(info.size / 1024 / 1024).toFixed(1)} MB · ${new Date(info.openedAt).toLocaleDateString()}`;
      button.append(detail);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await selectMaterial(info.key); element("library-dialog").close(); }
        catch { element("library-message").textContent = "无法打开这份材料，请重新导入原文件。"; }
        finally { button.disabled = false; }
      });
      element("library-list").append(button);
    });
  } catch {
    element("library-message").textContent = "无法访问本地材料库，请使用正常浏览模式，并确认浏览器有可用空间。";
  }
});
element("library-close").addEventListener("click", () => element("library-dialog").close());
element("library-dialog").addEventListener("close", () => element("menu").querySelector("summary").focus());

async function restoreLastMaterial() {
  const request = materialRequest;
  try {
    const key = await readLibrary("preferences", "lastMaterial");
    if (key && request === materialRequest) await selectMaterial(key, request);
  } catch {
    libraryWarning("无法恢复上次材料。请从历史材料选择，或重新导入音频。浏览器可能已清理本地数据。");
  }
}
restoreLastMaterial();
