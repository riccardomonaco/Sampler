import AudioPlayer from "./audio/audioplayer.js";
import createEqualizer from "./ui/ui.js";
import { eqBands } from "./audio/audioglobal.js";

export let audioplayer;

function initSampler() {
  createEqualizer();
}

document.addEventListener("DOMContentLoaded", async () => {
  await initSampler();
  audioplayer = new AudioPlayer();
});
