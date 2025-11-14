import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";

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

    this.cnt = document.getElementById('waveform');
    console.log(cnt);

    // Inizializza WaveSurfer
    this.initWaveSurfer();
    this.setupEventListeners();
  }

  initWaveSurfer() {
    console.log(cnt);

    this.wavesurfer = WaveSurfer.create({
      container: "#waveform",
      waveColor: "#ccc",
      progressColor: "#2196f3",
      cursorColor: "#333",
      height: 250,
      plugin: [this.regions],
    });

    // Event listeners di WaveSurfer
    this.wavesurfer.on("ready", () => {
      console.log("WaveSurfer ready");
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

  setupEventListeners() {
    document.getElementById("play-button").addEventListener("click", () => {
      wavesurfer.play();
    });

    document.getElementById("pause-button").addEventListener("click", () => {
      wavesurfer.pause();
    });

    document.getElementById("stop-button").addEventListener("click", () => {
      wavesurfer.stop();
    });

    document.getElementById("loop-button").addEventListener("click", () => {
      loopController();
    });

    document.getElementById("x2-button").addEventListener("click", () => {
      loopDurationSeconds *= 2;
      looping = false;
      regions.clearRegions();
      loopController();
    });

    document.getElementById("d2-button").addEventListener("click", () => {
      loopDurationSeconds /= 2;
      looping = false;
      regions.clearRegions();
      loopController();
    });
  }

  async loadAudioFile(file) {
    if (!file) return;

    try {
      // Carica il file in ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Decodifica con Web Audio API
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Carica la waveform in WaveSurfer
      this.wavesurfer.load(URL.createObjectURL(file));

      console.log("Audio caricato con successo");
    } catch (error) {
      console.error("Errore nel caricamento audio:", error);
    }
  }

  play() {
    if (!this.audioBuffer) return;

    if (this.isPlaying) {
      this.pause();
      return;
    }

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
    // Gestisci interazioni con la waveform
    console.log("Interazione con la waveform");
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
}

// Inizializza il player quando la pagina è caricata
document.addEventListener("DOMContentLoaded", () => {
  window.audioplayer = new AudioPlayer();
});
