import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";
import BeatDetect from "./BeatDetect.js";
// import BeatDetektor from "./beatdetektor.js";

import { eqBands } from "./audioglobal.js";
import { breakbeat, lofi } from "./audiobanks.js";

export default class AudioPlayer {
  constructor() {
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    this.audioSource = null;
    this.audioBuffer = null;
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.regions = RegionsPlugin.create();
    this.currentRegion = null;
    this.wavesurfer = null;
    this.isEmpty = true;
    this.isLooping = false;
    this.currentAudioURL = "";
    //this.beatDetector = new BeatDetektor(60, 180);

    this.filters = null;
    this.mediaNode = null;
    this.eqInitialized = false;

    this.bpm = 0;

    this.beatDetect = new BeatDetect({
      sampleRate: this.audioContext.sampleRate, // Most track are using this sample rate
      log: false, // Debug BeatDetect execution with logs
      perf: false, // Attach elapsed time to result object
      round: false, // To have an integer result for the BPM
      float: 4, // The floating precision in [1, Infinity]
      lowPassFreq: 150, // Low pass filter cut frequency
      highPassFreq: 100, // High pass filter cut frequency
      bpmRange: [70, 180], // The BPM range to output
      timeSignature: 4, // The number of beat in a measure
    });

    this.initWaveSurfer();
    this.setupEventListeners();
    this.initBeatDetect();
  }

  initWaveSurfer() {
    this.wavesurfer = WaveSurfer.create({
      container: "#waveform",
      waveColor: "#ccc",
      progressColor: "#3d7fb6ff",
      cursorColor: "#333",
      height: 250,
      plugins: [this.regions],
      audioContext: this.audioContext,
    });

    this.wavesurfer.on("decode", () => {
      // Aspetta un frame per essere sicuri che tutto sia pronto
      requestAnimationFrame(() => this.initEqualizer());
    });
    // Event listeners di WaveSurfer
    this.wavesurfer.on("ready", async () => {
      console.log("WaveSurfer ready");
      this.initEqualizer();
      this.bpm = await this.detectBPM();
      document.getElementById("bpm-led").textContent = this.bpm + " BPM";
      document.getElementById("plus-wrapper").remove();
    });

    this.wavesurfer.on("seek", (progress) => {
      this.handleSeek(progress);
    });

    this.wavesurfer.on("interaction", () => {
      this.handleInteraction();
    });

    // Gestione regioni
    this.wavesurfer.on("region-created", (region) => {
      this.handleRegionCreated(region);
    });

    this.wavesurfer.on("region-updated", (region) => {
      this.handleRegionUpdated(region);
    });

    this.wavesurfer.on("region-click", (region, e) => {
      this.handleRegionClick(region, e);
    });

    this.regions.on("region-in", (region) => {
      this.currentRegion = region;
    });

    this.regions.on("region-out", (region) => {
      console.log("region-out", region);
      if (this.currentRegion === region) {
        if (this.isLooping) {
          this.currentRegion.play();
        } else {
          this.currentRegion = null;
        }
      }
    });
  }

  initBeatDetect() {
    this.lockTimer = null; // Timer per capire quando hai finito
    this.lastTapTime = 0; // Per calcolare il reset della sessione
    const bpmLed = document.getElementById("bpm-led");

    this.beatDetect.tapBpm({
      element: bpmLed,
      precision: 4,
      callback: (bpm) => {
        const now = Date.now();

        // 1. Resetta il timer di "Lock" (perché hai appena cliccato ancora)
        if (this.lockTimer) {
          clearTimeout(this.lockTimer);
          this.lockTimer = null;
        }

        // 2. Controllo se è una NUOVA misurazione (dopo una pausa lunga)
        if (now - this.lastTapTime > 2000) {
          // Non aggiorniamo il testo al primissimo click della nuova serie
          // per evitare valori sballati, ma salviamo il tempo.
        } else {
          // --- DURANTE LA MISURAZIONE ---
          // Aggiorna il valore a schermo
          bpmLed.classList.remove("bpm-led-locked");

          this.bpm = Math.round(bpm);
          bpmLed.textContent = this.bpm + " BPM";

          // Assicurati che il colore sia quello di "edit"
        }

        this.lastTapTime = now;

        // 3. Imposta il timer per il LOCK
        // Se non clicchi per 2 secondi, questo codice verrà eseguito
        this.lockTimer = setTimeout(() => {
          // --- FINE SESSIONE (LOCK) ---
          bpmLed.classList.add("bpm-led-locked");
        }, 2000);
      },
    });

    this.beatDetect
      .getBeatInfo({
        url: this.currentAudioURL,
      })
      .then((info) => {
        console.log("SAAAAAAAAAAAAA");
        console.log(info.bpm); // 140
        console.log(info.offset); // 0.1542
        console.log(info.firstBar); // 0.1.8722
      })
      .catch((error) => {
        // The error string
      });
  }

  initAudio() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === "suspended") {
      return this.audioContext.resume();
    }
    this.initEqualizer();
    return Promise.resolve();
  }

  setupEventListeners() {
    document
      .getElementById("play-button")
      .addEventListener("click", async () => {
        this.wavesurfer.play();
      });

    document.getElementById("pause-button").addEventListener("click", () => {
      this.wavesurfer.pause();
    });

    document.getElementById("stop-button").addEventListener("click", () => {
      if (this.isLooping) {
        this.wavesurfer.seekTo(0);
      }
      this.wavesurfer.stop();
    });

    document.getElementById("loop-button").addEventListener("click", () => {
      if (!this.isLooping) {
        this.regions.addRegion({
          start: this.wavesurfer.getCurrentTime(),
          end: this.wavesurfer.getCurrentTime() + (60 / this.bpm) * 4,
          loop: true,

          // ▶️ Questi due valori rendono VISIBILE la region
          color: "rgba(165, 165, 165, 0.3)",
          handleStyle: {
            left: "rgba(0, 150, 255, 0.9)",
            right: "rgba(0, 150, 255, 0.9)",
          },
        });
      } else {
        this.regions.clearRegions();
      }
      this.isLooping = !this.isLooping;
      document
        .getElementById("loop-button")
        .classList.toggle("old-button-loop");
    });

    document.getElementById("x2-button").addEventListener("click", () => {
      if (this.isLooping) {
        this.regions.clearRegions();
        this.regions.addRegion({
          start: this.currentRegion.start,
          end: this.currentRegion.start + (this.currentRegion.end - this.currentRegion.start) * 2,
          loop: true,

          // ▶️ Questi due valori rendono VISIBILE la region
          color: "rgba(165, 165, 165, 0.3)",
          handleStyle: {
            left: "rgba(0, 150, 255, 0.9)",
            right: "rgba(0, 150, 255, 0.9)",
          },
        });
      }
    });

    document.getElementById("d2-button").addEventListener("click", () => {
            if (this.isLooping) {
        this.regions.clearRegions();
        this.regions.addRegion({
          start: this.currentRegion.start,
          end: this.currentRegion.start + (this.currentRegion.end - this.currentRegion.start) / 2,
          loop: true,

          // ▶️ Questi due valori rendono VISIBILE la region
          color: "rgba(165, 165, 165, 0.3)",
          handleStyle: {
            left: "rgba(0, 150, 255, 0.9)",
            right: "rgba(0, 150, 255, 0.9)",
          },
        });
      }
    });

    document.getElementById("bpm-led").addEventListener("click", () => {
      bpm = this.detectBPM();
      document.getElementById("bpm-led").textContent = Math.round(bpm) + "BPM";
    });

    const dropArea = document.getElementById("waveform");

    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("dragover");
    });

    dropArea.addEventListener("dragleave", () => {
      dropArea.classList.remove("dragover");
    });

    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("dragover");

      const file = e.dataTransfer.files[0];
      if (!file) return;

      const objectUrl = URL.createObjectURL(file);
      this.loadAudioFile(objectUrl);
      this.currentAudioURL = objectUrl;
      console.log(this.currentAudioURL);
    });
  }

  async loadAudioFile(file) {
    if (!file) return;

    try {
      await this.wavesurfer.load(file);
    } catch (error) {}
  }

  play() {}

  pause() {}

  stop() {}

  updatePlaybackPosition() {}

  handleSeek(progress) {}

  handleInteraction() {
    this.wavesurfer.play();
  }

  addRegion() {
    if (!this.wavesurfer.getDuration()) return;

    // Crea una regione di default
    const duration = this.wavesurfer.getDuration();
    const start = duration * 0.2;
    const end = duration * 0.6;

    const region = this.wavesurfer.addRegion({
      start: start,
      end: end,
      color: "rgba(255, 0, 0, 0.1)",
      drag: true,
      resize: true,
    });

    this.regions.push(region);
  }

  handleRegionCreated(region) {
    console.log("Regione creata:", region);
    this.regions.push(region);

    // Aggiungi listener per doppio click per impostare come regione corrente
    region.on("dblclick", () => {
      this.setCurrentRegion(region);
    });
  }

  handleRegionUpdated(region) {
    console.log("Regione aggiornata:", region);
  }

  handleRegionClick(region, e) {
    // Imposta come regione corrente al click
    this.setCurrentRegion(region);
  }

  setCurrentRegion(region) {
    // Rimuovi highlight dalla regione precedente
    if (this.currentRegion) {
      this.currentRegion.update({ color: "rgba(255, 0, 0, 0.1)" });
    }

    // Imposta nuova regione corrente
    this.currentRegion = region;
    region.update({ color: "rgba(0, 255, 0, 0.2)" });

    console.log("Regione corrente impostata:", region);

    // Se è in riproduzione, riavvia con la nuova regione
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  // Metodo per rimuovere il loop
  clearLoop() {
    this.currentRegion = null;
    this.regions.forEach((region) => {
      region.update({ color: "rgba(255, 0, 0, 0.1)" });
    });

    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  initEqualizer() {
    if (this.eqInitialized) return;

    const audio = this.wavesurfer.getMediaElement();

    // Crea il MediaElementSource UNA SOLA VOLTA
    this.mediaNode = this.audioContext.createMediaElementSource(audio);

    // Crea i filtri
    this.filters = eqBands.map((band) => {
      const filter = this.audioContext.createBiquadFilter();
      filter.type =
        band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
      filter.gain.value = 0; // Inizia flat
      filter.Q.value = 1;
      filter.frequency.value = band;
      return filter;
    });

    // Collega i filtri in serie
    let currentNode = this.mediaNode;
    this.filters.forEach((filter) => {
      currentNode.connect(filter);
      currentNode = filter;
    });

    // Collega l'ultimo filtro alla destinazione
    currentNode.connect(this.audioContext.destination);

    // Collega gli slider ai filtri
    this.connectSliders();

    this.eqInitialized = true;
  }

  connectSliders() {
    const sliders = document.querySelectorAll(".slider-eq");

    sliders.forEach((slider, i) => {
      if (this.filters[i]) {
        // Imposta il valore iniziale
        this.filters[i].gain.value = slider.value;

        // Aggiorna il filtro quando lo slider cambia
        slider.oninput = (e) => {
          this.filters[i].gain.value = e.target.value;
          console.log(`EQ Band ${eqBands[i]}Hz: ${e.target.value}dB`);
        };

        slider.oninput = (e) => {
          this.filters[i].gain.value = e.target.value;
          console.log(`EQ Band ${eqBands[i]}Hz: ${e.target.value}dB`);
        };
      }
    });
  }

  detectBPM() {
    /*     audioBuffer = this.wavesurfer.getDecodedData();
    let steps = int(this.audioBuffer / 512);

    steps.forEach((e) => {});

    try {
      const features = analyser.get(featuresToGet);

      this.beatDetector.process();
      beatDetektorKick.process(beatDetektor);
      const kick = beatDetektorKick.isKick();
      const bpm = beatDetektor.win_bpm_int_lo;

      bpmTitle.textContent = `BPM: ${bpm}`;
      kickTitle.textContent = `Kick: ${kick ? "kick" : ""}`;
    } catch (e) {}
  } */
    return 175;
  }
}
