"use strict";

const shortcutDefinitions = [
  { id: "play", label: "播放 / 暂停", key: " ", run: () => element("play").click() },
  { id: "previous", label: "上一个标记", key: "ArrowLeft", run: () => jumpMark(-1) },
  { id: "next", label: "下一个标记", key: "ArrowRight", run: () => jumpMark(1) },
  { id: "quickPrevious", label: "跳到上上个标记", key: "ArrowLeft", ctrl: true, run: () => jumpMark(-1, 2) },
  { id: "quickNext", label: "跳到下下个标记", key: "ArrowRight", ctrl: true, run: () => jumpMark(1, 2) },
  { id: "deleteBefore", label: "删除当前或之前的标记", key: "Backspace", run: () => deleteMark(-1) },
  { id: "deleteAfter", label: "删除后方标记", key: "Delete", run: () => deleteMark(1) },
  { id: "add", label: "添加标记", key: "+", run: () => element("add").click() }
];
const shortcutStorageKey = "my-listening:shortcuts:v1";
const shortcutDialog = element("shortcuts-dialog");
let recordingShortcut = null;
let shortcutBindings = defaultShortcuts();
let shortcutStorageWarning = "";

function defaultShortcuts() {
  return shortcutDefinitions.map((definition) => ({ key: definition.key, ctrl: !!definition.ctrl, alt: false, meta: false, shift: false }));
}

function bindingFromEvent(event) {
  return { key: event.key.length === 1 ? event.key.toLowerCase() : event.key, ctrl: !!event.ctrlKey, alt: !!event.altKey, meta: !!event.metaKey, shift: event.key === "+" ? false : !!event.shiftKey };
}

function bindingSignature(binding) {
  return JSON.stringify([binding.key, binding.ctrl, binding.alt, binding.meta, binding.shift]);
}

function bindingLabel(binding, accessible = false) {
  const names = accessible ? { " ": "Space", "+": "Plus" } : { " ": "空格", ArrowLeft: "←", ArrowRight: "→", "+": "+" };
  return [binding.ctrl && (accessible ? "Control" : "Ctrl"), binding.alt && "Alt", binding.meta && (accessible ? "Meta" : "⌘"), binding.shift && "Shift", names[binding.key] || binding.key].filter(Boolean).join("+");
}

function validBinding(binding) {
  return binding && typeof binding.key === "string" && (binding.key.length === 1 || /^(Arrow(Left|Right|Up|Down)|Backspace|Delete|Home|End|PageUp|PageDown|F([1-9]|1[0-2]))$/.test(binding.key)) && ["ctrl", "alt", "meta", "shift"].every((name) => typeof binding[name] === "boolean");
}

try {
  const saved = JSON.parse(localStorage.getItem(shortcutStorageKey) || "null");
  if (Array.isArray(saved) && saved.length === shortcutDefinitions.length && saved.every(validBinding) && new Set(saved.map(bindingSignature)).size === saved.length) shortcutBindings = saved;
} catch {
  shortcutStorageWarning = "无法读取快捷键设置，已使用默认值。";
}

function refreshShortcutTitles() {
  const groups = { play: [0], previous: [1], next: [2], "quick-previous": [3], "quick-next": [4], "delete-mark": [5, 6], add: [7] };
  Object.entries(groups).forEach(([id, indices]) => {
    element(id).title = indices.map((index) => `${shortcutDefinitions[index].label}（${bindingLabel(shortcutBindings[index])}）`).join("；");
    element(id).setAttribute("aria-keyshortcuts", indices.map((index) => bindingLabel(shortcutBindings[index], true)).join(" "));
  });
}

function saveShortcuts() {
  try {
    localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcutBindings));
    element("shortcut-message").textContent = "已保存。";
  } catch {
    element("shortcut-message").textContent = "本次设置已生效，但浏览器无法保存；关闭页面后可能丢失。";
  }
  refreshShortcutTitles();
}

function renderShortcuts() {
  element("shortcut-fields").replaceChildren();
  shortcutDefinitions.forEach((definition, index) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const label = document.createElement("span");
    label.textContent = definition.label;
    const button = document.createElement("button");
    button.className = "shortcut-key";
    button.textContent = bindingLabel(shortcutBindings[index]);
    button.setAttribute("aria-label", `设置${definition.label}快捷键，当前为${button.textContent}`);
    button.addEventListener("click", () => {
      recordingShortcut = index;
      element("shortcut-fields").querySelectorAll("button").forEach((control, position) => {
        control.classList.toggle("recording", position === index);
        control.textContent = position === index ? "请按键…" : bindingLabel(shortcutBindings[position]);
      });
      element("shortcut-message").textContent = "请按新的快捷键；Esc 取消。不要使用浏览器或系统保留的组合键。";
    });
    button.addEventListener("blur", () => {
      if (recordingShortcut === index) recordingShortcut = null;
      button.classList.remove("recording");
      button.textContent = bindingLabel(shortcutBindings[index]);
    });
    row.append(label, button);
    element("shortcut-fields").append(row);
  });
}

element("shortcuts-open").addEventListener("click", () => {
  element("menu").open = false;
  recordingShortcut = null;
  renderShortcuts();
  if (shortcutStorageWarning) element("shortcut-message").textContent = shortcutStorageWarning;
  shortcutDialog.showModal();
});
element("shortcuts-close").addEventListener("click", () => shortcutDialog.close());
shortcutDialog.addEventListener("close", () => {
  recordingShortcut = null;
  element("menu").querySelector("summary").focus();
});
element("shortcuts-reset").addEventListener("click", () => {
  recordingShortcut = null;
  shortcutBindings = defaultShortcuts();
  renderShortcuts();
  saveShortcuts();
});

document.addEventListener("keydown", (event) => {
  if (event.isComposing || event.defaultPrevented) return;
  if (shortcutDialog.open) {
    if (recordingShortcut === null || event.key === "Tab") return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.key === "Escape") {
      recordingShortcut = null;
      event.target.blur();
      element("shortcut-message").textContent = "已取消，原快捷键未改变。";
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    const binding = bindingFromEvent(event);
    if (!validBinding(binding)) {
      element("shortcut-message").textContent = "请选择字母、数字、符号、方向键或组合键；Tab、Enter、Esc 保留给面板操作。";
      return;
    }
    const conflict = shortcutBindings.findIndex((existing, index) => index !== recordingShortcut && bindingSignature(existing) === bindingSignature(binding));
    if (conflict !== -1) {
      element("shortcut-message").textContent = `已用于“${shortcutDefinitions[conflict].label}”，请换一个按键。`;
      return;
    }
    const index = recordingShortcut;
    shortcutBindings[index] = binding;
    recordingShortcut = null;
    saveShortcuts();
    renderShortcuts();
    element("shortcut-fields").querySelectorAll("button")[index].focus();
    return;
  }
  if (!ready || element("backup-dialog").open || element("library-dialog").open || element("note-dialog").open || element("menu").open || event.target.closest('input:not([type="range"]), select, textarea, [contenteditable], summary, #notes-page, #note-detail-window')) return;
  const index = shortcutBindings.findIndex((binding) => bindingSignature(binding) === bindingSignature(bindingFromEvent(event)));
  if (index === -1) return;
  event.preventDefault();
  if (!event.repeat) shortcutDefinitions[index].run();
});
refreshShortcutTitles();
