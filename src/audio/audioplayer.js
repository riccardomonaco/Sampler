import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";

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

    this.filters = null;
    this.mediaNode = null;
    this.eqInitialized = false;

    this.bpm = 0;

    this.initWaveSurfer();
    this.setupEventListeners();
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
      this.wavesurfer.stop();
    });

    document.getElementById("loop-button").addEventListener("click", () => {});

    document.getElementById("x2-button").addEventListener("click", () => {});

    document.getElementById("d2-button").addEventListener("click", () => {});

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
    });
  }

  async loadAudioFile(file) {
    if (!file) return;

    try {
      await this.wavesurfer.load(file);
    } catch (error) {}
  }

  play() {
    if (!this.audioBuffer) return;

    this.isPlaying = true;

    // Crea source node
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = this.audioBuffer;
    this.audioSource.connect(this.audioContext.destination);

    // Gestione loop region
    if (this.currentRegion) {
      const region = this.currentRegion;
      const start = region.start * this.audioBuffer.duration;
      const end = region.end * this.audioBuffer.duration;

      this.audioSource.loop = true;
      this.audioSource.loopStart = start;
      this.audioSource.loopEnd = end;

      this.audioSource.start(0, start);
      this.startTime = this.audioContext.currentTime - start;
    } else {
      // Play normale
      const startTime = this.pauseTime;
      this.audioSource.start(0, startTime);
      this.startTime = this.audioContext.currentTime - startTime;
    }

    // Aggiorna WaveSurfer
    this.wavesurfer.play();

    // Animation frame per sync
    this.updatePlaybackPosition();
  }

  pause() {
    if (!this.isPlaying || !this.audioSource) return;

    this.isPlaying = false;
    this.pauseTime = this.audioContext.currentTime - this.startTime;

    // Ferma Web Audio
    this.audioSource.stop();
    this.audioSource = null;

    // Ferma WaveSurfer
    this.wavesurfer.pause();
  }

  stop() {
    this.isPlaying = false;
    this.pauseTime = 0;
    this.startTime = 0;

    if (this.audioSource) {
      this.audioSource.stop();
      this.audioSource = null;
    }

    this.wavesurfer.stop();
    this.wavesurfer.seekTo(0);
  }

  updatePlaybackPosition() {
    if (!this.isPlaying) return;

    const currentTime = this.audioContext.currentTime - this.startTime;
    const duration = this.audioBuffer.duration;
    const progress = currentTime / duration;

    // Aggiorna la posizione di WaveSurfer
    if (progress >= 0 && progress <= 1) {
      this.wavesurfer.seekTo(progress);
    }

    // Continua l'update
    requestAnimationFrame(() => this.updatePlaybackPosition());
  }

  handleSeek(progress) {
    if (this.isPlaying) {
      // Se è in riproduzione, aggiorna la posizione di Web Audio
      this.pause();
      this.pauseTime = progress * this.audioBuffer.duration;
      this.play();
    } else {
      // Se è in pausa, aggiorna solo il tempo di pausa
      this.pauseTime = progress * this.audioBuffer.duration;
    }
  }

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
    return 175;
  }
}
