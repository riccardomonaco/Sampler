import createEqualizer from "./ui/ui.js";
import AudioPlayer from "./audio/audioplayer.js"

var audioplayer;

function initSampler() {
  createEqualizer();
}

function dragoverSamplerHandler(ev) {
  ev.preventDefault();
}

function dropSamplerHandler(ev) {
  ev.preventDefault();
  const data = ev.dataTransfer.getData("text");
  ev.target.appendChild(document.getElementById(data));
}

document.addEventListener("DOMContentLoaded", async () => {
  await (audioplayer = new AudioPlayer());
  const unlockAudio = async () => {
    await audioplayer.initAudio();
    console.log("Audio unlocked:", audioplayer.audioContext.state);
    window.removeEventListener("click", unlockAudio);
  };
  window.addEventListener("click", unlockAudio);
  await initSampler();
});
