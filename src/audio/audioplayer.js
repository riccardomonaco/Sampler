import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";
import BeatDetect from "./BeatDetect.js";

import { eqBands } from "./audioglobal.js";
import { bufferToWave } from "./audioglobal.js";
export default class AudioPlayer {
  constructor() {
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();

    // Wavesurfer variables
    this.wavesurfer = null;
    this.regions = RegionsPlugin.create();
    this.currentRegion = null;
    this.filters = [];

    // Internal state variables
    this.isEmpty = true;
    this.isLooping = false;
    this.currentAudioURL = "";
    this.originalBuffer = null;
    this.bpm = 0;
    this.history = [];
    this.redoStack = [];
    this.maxHistory = 10;

    // Beat detection config structure
    this.beatDetect = new BeatDetect({
      sampleRate: this.audioContext.sampleRate,
      log: false,
      perf: false,
      round: false,
      float: 4,
      lowPassFreq: 150,
      highPassFreq: 100,
      bpmRange: [70, 180],
      timeSignature: 4,
    });

    // Init methods
    this.initWaveSurfer();
    this.setupEventListeners();
    this.initBeatDetect();
  }

  /**
   * Initializing Wavesurfer related states and variables
   *
   * @memberof AudioPlayer
   */
  initWaveSurfer() {
    //Create and config wavesufer main obj
    this.wavesurfer = WaveSurfer.create({
      container: "#waveform",
      waveColor: "#ccc",
      progressColor: "#4b657aff",
      cursorColor: "#333",
      height: 250,
      plugins: [this.regions],
      audioContext: this.audioContext,
    });

    // 'decode' -> When audio is loaded, then get data
    this.wavesurfer.on("decode", () => {
      const buffer = this.wavesurfer.getDecodedData();
      if (buffer) {
        // Create a copy of audio in a buffer
        this.originalBuffer = buffer;
        requestAnimationFrame(() => this.initEqualizer());
      }
    });

    // 'ready' -> When audio is ready
    this.wavesurfer.on("ready", async () => {
      this.initEqualizer();
      await this.detectBPM();
      document.getElementById("plus-wrapper").remove();
      this.regions.enableDragSelection({
        color: "rgba(165, 165, 165, 0.3)",
      });
    });

    this.wavesurfer.on("click", (relativeX) => {
      /*       const isPlaying = this.wavesurfer.isPlaying();

      if (isPlaying) {
      } else {
        const duration = this.wavesurfer.getDuration();
        const timestamp = duration * relativeX;

        this.createMarker(timestamp);
      } */
    });

    this.wavesurfer.on("seek", (progress) => {
      this.handleSeek(progress);
    });

    this.wavesurfer.on("interaction", () => {
      this.handleInteraction();
    });

    this.regions.on("region-created", (region) => {
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
      if (this.isLooping && this.currentRegion === region) {
        region.play();
      }
    });
  }

  /**
   * Instantiate and config beat detection main obj
   *
   * @memberof AudioPlayer
   */
  initBeatDetect() {
    this.lockTimer = null;
    this.lastTapTime = 0;
    const bpmLed = document.getElementById("bpm-led");

    this.beatDetect.tapBpm({
      element: bpmLed,
      precision: 4,
      callback: (bpm) => {
        const now = Date.now();

        if (this.lockTimer) {
          clearTimeout(this.lockTimer);
          this.lockTimer = null;
        }

        if (now - this.lastTapTime > 2000) {
        } else {
          bpmLed.classList.remove("bpm-led-locked");

          this.bpm = Math.round(bpm);
          bpmLed.textContent = this.bpm + " BPM";
        }

        this.lastTapTime = now;

        this.lockTimer = setTimeout(() => {
          bpmLed.classList.add("bpm-led-locked");
        }, 2000);
      },
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

  /**
   * Add listeners to buttons
   *
   * @memberof AudioPlayer
   */
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
          end:
            this.currentRegion.start +
            (this.currentRegion.end - this.currentRegion.start) * 2,
          loop: true,
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
        this.wavesurfer.seekTo(this.currentRegion.start);
        this.regions.clearRegions();
        this.regions.addRegion({
          start: this.currentRegion.start,
          end:
            this.currentRegion.start +
            (this.currentRegion.end - this.currentRegion.start) / 2,
          loop: true,
          color: "rgba(165, 165, 165, 0.3)",
          handleStyle: {
            left: "rgba(0, 150, 255, 0.9)",
            right: "rgba(0, 150, 255, 0.9)",
          },
        });
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === " ") {
        this.wavesurfer.playPause();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        this.redo();
      }
    });

    document.getElementById("bpm-led").addEventListener("click", () => { });

    document.getElementById('trim-btn').addEventListener('click', () => {
      this.trimAudio();
    });



    // Drag and drop audio file logic
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

      const type = e.dataTransfer.getData("type");
      const url = e.dataTransfer.getData("audioUrl");

      if (type === "sample" && url) {
        this.wavesurfer.load(url);
        this.currentAudioURL = url;
      } else if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (!file) return;

        const objectUrl = URL.createObjectURL(file);
        this.loadAudioFile(objectUrl);
        this.currentAudioURL = objectUrl;
      }
    });
  }

  /**
   *
   *
   * @param {*} file
   * @return {*} 
   * @memberof AudioPlayer
   */
  async loadAudioFile(file) {
    if (!file) return;

    try {
      await this.wavesurfer.load(file);
    } catch (error) { }
  }


  handleInteraction() {
    this.wavesurfer.play();
  }

  addRegion() {
    /*     if (!this.wavesurfer.getDuration()) return;
    
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
    
        this.regions.push(region); */
  }

  handleRegionCreated(region) {
    console.log("DEBUG");

    const regionElement = region.element;
    console.log(region.element);

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'region-close-btn';
    deleteBtn.textContent = 'x'; // Carattere "per" matematico, più bello della x
    deleteBtn.title = "Delete Region"; // Tooltip

    Object.assign(deleteBtn.style, {
      position: 'absolute',
      top: '5px',
      right: '5px',
      width: '24px',        // Un po' più grande per essere cliccabile
      height: '24px',
      backgroundColor: '--var(lgrey)', // Il tuo rosso
      color: 'white',
      borderRadius: '0 0 0 4px',
      fontFamily: 'Pixelify Sans, system-ui',
      fontWeight: 'normal',
      fontSize: '20px',
      lineHeight: '22px',   // Centratura verticale manuale
      textAlign: 'center',
      cursor: 'pointer',
      zIndex: '10',
      userSelect: 'none'
    });

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.backgroundColor = '--var(dgrey)'; // Rosso acceso
      deleteBtn.style.transform = 'scale(1.2)';
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.backgroundColor = '--var(lgrey)'; // Rosso base
      deleteBtn.style.transform = 'scale(1)';
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      region.remove();

      if (this.currentRegion === region) {
        this.currentRegion = null;
      }
    });

    regionElement.appendChild(deleteBtn);

    if (regionElement) {
      regionElement.addEventListener("dragover", (e) => {
        e.preventDefault();
        regionElement.style.border = "2px solid white";
      });

      region.on("dblclick", (e) => {
        e.stopPropagation();
        document.getElementById("loop-button").click();
        this.setCurrentRegion(region);
      });
    }
  }

  handleRegionUpdated(region) {
    console.log("Regione aggiornata:", region);
  }

  handleRegionClick(region, e) {
    this.handleRegionClick(region, e);
    e.stopPropagation();
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

  async detectBPM() {
    this.beatDetect
      .getBeatInfo({
        url: this.currentAudioURL,
      })
      .then((info) => {
        console.log(info.bpm); // 140
        console.log(info.offset); // 0.1542
        console.log(info.firstBar); // 0.1.8722
        this.bpm = Math.round(info.bpm);
        document.getElementById("bpm-led").textContent = this.bpm + " BPM";
      })
      .catch((error) => {
        // The error string
      });
  }

  createMarker(startTime) {
    const duration = 0;

    const region = this.regions.addRegion({
      start: startTime,
      end: startTime + duration,
      color: "rgba(0, 255, 0, 0.3)", // Verde semitrasparente
      drag: true,
      resize: true,
    });
  }

  addToHistory(url) {
    this.history.push(url);
    if (this.history.length > this.maxHistory) this.history.shift();

    this.redoStack = [];
    console.log("History saved. Steps:", this.history.length);
  }

  undo() {
    if (this.history.length === 0) return;

    this.redoStack.push(this.currentAudioURL);

    const previousUrl = this.history.pop();

    console.log("Undoing...");
    this.wavesurfer.load(previousUrl);
    this.currentAudioURL = previousUrl;

    this.regions.clearRegions();
  }

  redo() {
    if (this.redoStack.length === 0) return;

    this.history.push(this.currentAudioURL);

    const nextUrl = this.redoStack.pop();

    console.log("Redoing...");
    this.wavesurfer.load(nextUrl);
    this.currentAudioURL = nextUrl;
  }


}
