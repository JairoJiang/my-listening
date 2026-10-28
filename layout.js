"use strict";

function detectMobileLayout(device, viewport) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent || "")
    || (device.platform === "MacIntel" && device.maxTouchPoints > 1)
    || (viewport("(pointer: coarse)").matches && viewport("(max-width: 1024px)").matches);
}

const layoutOptions = ["auto", "mobile", "desktop"];
const layoutURL = new URL(window.location.href);
let layoutPreference = "auto";
try {
  const saved = localStorage.getItem("my-listening:layout:v1");
  if (layoutOptions.includes(saved)) layoutPreference = saved;
} catch {}
const requestedLayout = layoutURL.searchParams.get("layout");
if (layoutOptions.includes(requestedLayout)) layoutPreference = requestedLayout;
const activeLayout = layoutPreference === "auto"
  ? (detectMobileLayout(navigator, window.matchMedia.bind(window)) ? "mobile" : "desktop")
  : layoutPreference;
document.documentElement.dataset.layout = activeLayout;
if (activeLayout === "mobile") {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "iphone.css";
  document.head.append(stylesheet);
}

function updateMobileViewport() {
  if (activeLayout !== "mobile") return;
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty("--visible-height", `${viewport ? viewport.height : window.innerHeight}px`);
  document.documentElement.style.setProperty("--visible-top", `${viewport ? viewport.offsetTop : 0}px`);
}
updateMobileViewport();
window.visualViewport?.addEventListener("resize", updateMobileViewport);
window.visualViewport?.addEventListener("scroll", updateMobileViewport);
window.addEventListener("resize", updateMobileViewport);

document.addEventListener("DOMContentLoaded", () => {
  const choice = document.getElementById("layout-choice");
  choice.value = layoutPreference;
  choice.title = "切换界面会重新加载页面，需要重新选择音频";
  choice.addEventListener("change", () => {
    try { localStorage.setItem("my-listening:layout:v1", choice.value); } catch {}
    const destination = new URL(window.location.href);
    destination.searchParams.set("layout", choice.value);
    window.location.replace(destination.href);
  });
});
