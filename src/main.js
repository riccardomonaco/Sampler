/**
 * main.js
 * Application entry point.
 * Coordinates DOM initialization and Audio Engine startup.
 */

import { createPageDefault } from "./ui/Ui.js";
import AudioPlayer from "./audio/AudioPlayer.js";
import { signInAnonymously } from "firebase/auth";
import { auth } from "./firebase.js";
import { bankService } from "./services/BankService.js";
import "../node_modules/pixelarticons/fonts/pixelart-icons-font.css"

// Global AudioPlayer instance
let audioPlayer;

/**
 * Initializes the application flow.
 */
async function initApp() {

  try {

    // 1. Login Silenzioso (Indispensabile per scrivere su DB)
    await signInAnonymously(auth);
    console.log("Logged in as:", auth.currentUser.uid);

    // 2. Scarica i dati delle banche
    await bankService.loadAll();
    console.log("Banks loaded!");
    // 1. Build the User Interface
    // This clears any existing DOM and builds the Sampler, Effects, and Banks.
    createPageDefault();

    // 2. Initialize Audio Engine
    // Now it can safely find DOM elements like #waveform, #knob-p1, etc.
    audioPlayer = new AudioPlayer();

    // 3. Setup Audio Context Unlock (Browser Policy)
    const unlockAudio = async () => {
      if (audioPlayer) {
        await audioPlayer.initAudio();
        console.log("Audio Context Unlocked:", audioPlayer.audioContext.state);
        window.removeEventListener("click", unlockAudio);
      }
    };

    // Bind global unlock listener
    window.addEventListener("click", unlockAudio);
  } catch (error) {
    console.error("Initialization failed:", error);
    alert("Errore di connessione al Database. Controlla la console.");
  }
}

// Bootstrap application on DOM Ready
document.addEventListener("DOMContentLoaded", initApp);