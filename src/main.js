import createEqualizer from "./ui/ui.js";
import { initBankMenu } from "./ui/ui.js";
import AudioPlayer from "./audio/audioplayer.js";
import { signInAnonymously } from "firebase/auth";
import { auth } from "./firebase.js";

var audioplayer;

function initSampler() {
  createEqualizer();
  initBankMenu();
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
