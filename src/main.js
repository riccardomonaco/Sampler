import AudioPlayer from "./audio/audioplayer.js";
import createEqualizer from "./ui/ui.js";
import { eqBands } from "./audio/audioglobal.js";

export const audioplayer = new AudioPlayer();

function initSampler() {
  createEqualizer();
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Audio context state:", audioplayer.context?.state);
  console.log("Audio element ready:", audioplayer.audio?.readyState);
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason?.message?.includes("message port closed")) {
      event.preventDefault();
    }
  });
});

await initSampler();
