"use strict";

const videoStage = element("video-stage");
const noteHome = element("note-dialog").parentNode;

function resetVideoView() {
  if (document.fullscreenElement === videoStage) document.exitFullscreen().catch(() => {});
  videoStage.hidden = true;
  document.documentElement.classList.remove("has-video");
}

audio.addEventListener("loadedmetadata", () => {
  const hasVideo = audio.videoWidth > 0 && audio.videoHeight > 0;
  videoStage.hidden = !hasVideo;
  document.documentElement.classList.toggle("has-video", hasVideo);
  renderVideoMarks();
  updateVideoProgress();
  if (ready) renderMarks();
});

function updateVideoProgress() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  element("fullscreen-progress").max = String(duration);
  element("fullscreen-progress").value = String(audio.currentTime || 0);
  element("fullscreen-time").textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
}

function renderVideoMarks() {
  const track = element("fullscreen-markers");
  track.replaceChildren();
  if (!ready || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const lanes = [];
  marks.forEach((time) => {
    const fraction = time / audio.duration;
    const pixel = fraction * Math.max(1, track.clientWidth - 32);
    let lane = lanes.findIndex((end) => pixel - end >= 32);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = pixel;
    const marker = document.createElement("button");
    marker.className = "fullscreen-marker";
    marker.textContent = "⚑";
    marker.style.left = `calc(16px + (100% - 32px) * ${fraction})`;
    marker.style.top = `${lane * 32}px`;
    marker.setAttribute("aria-label", `${formatTime(time)}，查看笔记`);
    marker.title = formatTime(time);
    marker.addEventListener("click", () => {
      selectedMark = time;
      seek(time);
      updateSelection();
      openNote(time);
    });
    track.append(marker);
  });
  track.style.height = `${Math.min(3, Math.max(1, lanes.length)) * 32}px`;
}

for (const id of ["video-play", "fullscreen-play"]) element(id).addEventListener("click", () => element("play").click());
element("fullscreen-add").addEventListener("click", () => element("add").click());
element("fullscreen-progress").addEventListener("input", (event) => seek(Number(event.target.value)));
element("video-fullscreen").addEventListener("click", async () => {
  try {
    if (!videoStage.requestFullscreen) throw new Error("unsupported");
    await videoStage.requestFullscreen();
  } catch { announce("浏览器未能进入全屏，请使用支持网页全屏的桌面浏览器。", true); }
});
element("fullscreen-exit").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  const fullscreen = document.fullscreenElement === videoStage;
  const dialog = element("note-dialog");
  if (!dialog.open) (fullscreen ? videoStage : noteHome).append(dialog);
  renderVideoMarks();
  if (fullscreen) element("fullscreen-play").focus();
  else if (ready) renderMarks();
});
element("note-dialog").addEventListener("close", () => {
  if (document.fullscreenElement !== videoStage) noteHome.append(element("note-dialog"));
  else element("fullscreen-play").focus();
});
for (const name of ["play", "pause", "ended", "emptied"]) audio.addEventListener(name, () => {
  for (const id of ["video-play", "fullscreen-play"]) {
    element(id).textContent = audio.paused ? "▶" : "Ⅱ";
    element(id).setAttribute("aria-label", audio.paused ? "播放" : "暂停");
  }
});
audio.addEventListener("error", () => { element("fullscreen-message").textContent = "视频播放失败，请退出全屏并尝试其他格式。"; });
audio.addEventListener("loadstart", () => { element("fullscreen-message").textContent = ""; });
window.addEventListener("resize", () => { if (document.fullscreenElement === videoStage) renderVideoMarks(); });
