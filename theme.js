"use strict";

const themeStorageKey = "my-listening:theme:v1";
let listeningTheme = "light";
try { if (localStorage.getItem(themeStorageKey) === "night") listeningTheme = "night"; } catch {}

function applyListeningTheme() {
  document.documentElement.dataset.theme = listeningTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", listeningTheme === "night" ? "#101827" : "#fafbf9");
  const button = document.getElementById("theme-toggle");
  if (button) {
    button.setAttribute("aria-pressed", String(listeningTheme === "night"));
    button.textContent = listeningTheme === "night" ? "夜间模式 ✓" : "夜间模式";
  }
}
applyListeningTheme();

document.addEventListener("DOMContentLoaded", () => {
  applyListeningTheme();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    listeningTheme = listeningTheme === "night" ? "light" : "night";
    applyListeningTheme();
    try { localStorage.setItem(themeStorageKey, listeningTheme); } catch {}
  });
  const header = document.querySelector(".topbar");
  const updateHeaderHeight = () => document.documentElement.style.setProperty("--topbar-height", `${header.getBoundingClientRect().height}px`);
  updateHeaderHeight();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateHeaderHeight).observe(header);
  window.addEventListener("resize", updateHeaderHeight);
});
