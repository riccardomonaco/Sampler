import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";
import BeatDetect from "./BeatDetect.js";

import { eqBands } from "./audioglobal.js";
import { bufferToWave } from "./audioglobal.js";
export default class AudioPlayer {
  constructor() {
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: 44100
      });

    console.log("AudioContext forzato a:", this.audioContext.sampleRate); // Dovrebbe stampare 44100

    // Wavesurfer variables
    this.wavesurfer = null;
    this.regions = null;
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

    if (this.wavesurfer) {
      this.wavesurfer.destroy();
      this.wavesurfer = null;
    }

    this.regions = RegionsPlugin.create(); // Ricrea il plugin regioni
    this.eqInitialized = false;

    this.wavesurfer = WaveSurfer.create({
      container: "#waveform",
      waveColor: "#ccc",
      progressColor: "#4b657aff",
      cursorColor: "#333",
      height: 250,
      plugins: [this.regions],
      audioContext: this.audioContext,
      sampleRate: this.audioContext.sampleRate
    });

    this.wavesurfer.on("decode", () => {
      const buffer = this.wavesurfer.getDecodedData();
      if (buffer) {
        // Create a copy of audio in a buffer
        this.originalBuffer = buffer;
        requestAnimationFrame(() => this.initEqualizer());
      }
    });

    this.wavesurfer.on("ready", async () => {
      this.initEqualizer();
      this.createTrimUI();
      await this.detectBPM();
      document.getElementById("plus-wrapper").remove();
      this.regions.enableDragSelection({
        color: "rgba(165, 165, 165, 0.3)",
      });
      this.initTrimCurtains();
    });

    this.wavesurfer.on("click", (relativeX) => { });

    this.wavesurfer.on("seek", (progress) => {
      this.handleSeek(progress);
    });

    this.wavesurfer.on("interaction", () => {
      this.handleInteraction();
    });

    this.regions.on("region-created", (region) => {
      if (region.id === "left-curtain" || region.id === "right-curtain") return;
      this.handleRegionCreated(region);
    });

    this.wavesurfer.on("region-updated", (region) => {
      if (region.id === "left-curtain" || region.id === "right-curtain") return;
      this.handleRegionUpdated(region);
    });

    this.wavesurfer.on("region-click", (region, e) => {
      if (region.id === "left-curtain" || region.id === "right-curtain") return;
      this.handleRegionClick(region, e);
    });

    this.regions.on("region-in", (region) => {
      if (region.id === "left-curtain" || region.id === "right-curtain") return;
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

  initTrimCurtains() {
    const duration = this.wavesurfer.getDuration();
    // Colore scuro semi-trasparente per le zone escluse
    const shadowColor = "rgba(0, 0, 0, 0.65)";
    // Stile base della linea della handle (il resto lo facciamo in CSS)
    const handleColor = "var(--color-red)";

    // Pulisci le vecchie tende
    const currentRegions = this.regions.getRegions();
    currentRegions.forEach(r => {
      if (r.id === "left-curtain" || r.id === "right-curtain") {
        r.remove();
      }
    });

    // 1. Tenda Sinistra (L'ombra parte da 0 e finisce dove inizia la selezione)
    this.leftCurtain = this.regions.addRegion({
      id: "left-curtain",
      start: 0,
      end: 0, // Inizia chiusa
      color: shadowColor,
      drag: false,   // Non spostare l'intera regione
      resize: true,  // Permetti ridimensionamento
      loop: false,
      handleStyle: {
        left: { display: "none" }, // Nessuna handle a sinistra (è bloccata a 0)
        right: {
          backgroundColor: handleColor,
          width: "4px", // Linea sottile
          opacity: "1",
          zIndex: "10"
        }
      }
    });

    // 2. Tenda Destra (L'ombra inizia dove finisce la selezione e va fino alla fine)
    this.rightCurtain = this.regions.addRegion({
      id: "right-curtain",
      start: duration,
      end: duration, // Inizia chiusa
      color: shadowColor,
      drag: false,
      resize: true,
      loop: false,
      handleStyle: {
        left: {
          backgroundColor: handleColor,
          width: "4px", // Linea sottile
          opacity: "1",
          zIndex: "10"
        },
        right: { display: "none" } // Nessuna handle a destra (è bloccata alla fine)
      }
    });
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
  }

  handleRegionCreated(region) {
    if (region.id === "trim-region") return;

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

      // --- LOGICA DROP EFFETTI ---

      // Quando passi sopra con l'effetto
      regionElement.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Feedback visivo (diventa biancastro)
        regionElement.style.backgroundColor = "rgba(255, 255, 255, 0.5)";
      });

      // Quando esci senza lasciare
      regionElement.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Torna al colore normale
        regionElement.style.backgroundColor = region.color;
      });

      // Quando RILASCI l'effetto
      regionElement.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const effectType = e.dataTransfer.getData("effectType");

        if (effectType) {
          console.log(`Applicando effetto: ${effectType}`);
          // Flash Verde di conferma
          regionElement.style.backgroundColor = "rgba(0, 255, 0, 0.8)";

          // Applica l'effetto
          this.applyEffectToRegion(region, effectType);
        }
      });
    }
  }

  handleRegionUpdated(region) {
    console.log("Regione aggiornata:", region);
  }

  handleRegionClick(region, e) {
    e.stopPropagation();
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
    const audio = this.wavesurfer.getMediaElement();
    if (!audio) return;

    // Assicuriamo che l'audio possa essere processato (CORS)
    audio.crossOrigin = "anonymous";

    // --- FIX: EVITARE DOPPIE CONNESSIONI ---
    // Se abbiamo già creato i nodi per questo player, NON ricrearli.
    // Wavesurfer v7 riusa lo stesso elemento <audio>, quindi i nodi restano validi.
    if (this.eqInitialized && this.mediaNode) {
      console.log("EQ già inizializzato, salto la creazione dei nodi.");
      return;
    }

    // Se arriviamo qui, è la prima volta assoluta. Creiamo la catena.
    if (!this.mediaNode) {
      this.mediaNode = this.audioContext.createMediaElementSource(audio);
    }

    // Crea i filtri solo se non esistono
    if (this.filters.length === 0) {
      this.filters = eqBands.map((band) => {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
        filter.gain.value = 0;
        filter.Q.value = 1;
        filter.frequency.value = band;
        return filter;
      });

      // Collega i slider (assicurati che this.connectSliders esista e funzioni)
      this.connectSliders();
    }

    // --- COLLEGAMENTI ---
    // Disconnetti tutto per sicurezza prima di ricollegare
    try { this.mediaNode.disconnect(); } catch (e) { }
    this.filters.forEach(f => { try { f.disconnect(); } catch (e) { } });

    // Ricostruisci la catena: Source -> Filtri -> Destination
    let currentNode = this.mediaNode;
    this.filters.forEach((filter) => {
      currentNode.connect(filter);
      currentNode = filter;
    });

    currentNode.connect(this.audioContext.destination);

    this.eqInitialized = true;
    console.log("Equalizzatore collegato correttamente.");
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

  createTrimUI() {
    const container = document.getElementById("waveform");

    // Pulizia vecchi elementi se ricarichi il file
    container.querySelectorAll('.trim-ui-element').forEach(el => el.remove());

    // 1. Inizializza stato UI se non esiste
    this.trimUI = { container };

    // 2. Crea Overlay Sinistro
    this.trimUI.leftOverlay = document.createElement('div');
    this.trimUI.leftOverlay.className = 'trim-overlay trim-ui-element';
    this.trimUI.leftOverlay.style.left = '0';
    this.trimUI.leftOverlay.style.width = '0%';

    // 3. Crea Overlay Destro
    this.trimUI.rightOverlay = document.createElement('div');
    this.trimUI.rightOverlay.className = 'trim-overlay trim-ui-element';
    this.trimUI.rightOverlay.style.right = '0';
    this.trimUI.rightOverlay.style.width = '0%';

    // 4. Crea Maniglia START
    this.trimUI.leftHandle = document.createElement('div');
    this.trimUI.leftHandle.className = 'trim-handle trim-handle-left trim-ui-element';
    this.trimUI.leftHandle.innerText = "|";
    this.trimUI.leftHandle.style.left = '0%';

    // 5. Crea Maniglia END
    this.trimUI.rightHandle = document.createElement('div');
    this.trimUI.rightHandle.className = 'trim-handle trim-handle-right trim-ui-element';
    this.trimUI.rightHandle.innerText = "|";
    this.trimUI.rightHandle.style.left = '100%';
    this.trimUI.rightHandle.style.transform = "translateX(-100%)"; // Sposta indietro della sua larghezza per stare dentro

    // Append al DOM
    container.appendChild(this.trimUI.leftOverlay);
    container.appendChild(this.trimUI.rightOverlay);
    container.appendChild(this.trimUI.leftHandle);
    container.appendChild(this.trimUI.rightHandle);

    // Attiva Logica Drag
    this.enableDrag(this.trimUI.leftHandle, 'left');
    this.enableDrag(this.trimUI.rightHandle, 'right');
  }

  enableDrag(element, type) {
    let isDragging = false;

    // Inizio Drag
    element.addEventListener('mousedown', (e) => {
      isDragging = true;
      e.stopPropagation(); // Ferma il click di WaveSurfer
      document.body.style.cursor = 'col-resize';
    });

    // Movimento Mouse (Global window per non perdere il focus uscendo dal div)
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const rect = this.trimUI.container.getBoundingClientRect();
      let x = e.clientX - rect.left;

      // Limiti (0 -> Width)
      if (x < 0) x = 0;
      if (x > rect.width) x = rect.width;

      const percentage = (x / rect.width) * 100;

      if (type === 'left') {
        // Non superare la maniglia destra (con un margine di sicurezza 5%)
        const rightPos = parseFloat(this.trimUI.rightHandle.style.left) || 100;
        if (percentage >= rightPos - 2) return;

        element.style.left = percentage + '%';
        this.trimUI.leftOverlay.style.width = percentage + '%';
      } else {
        // Non superare la maniglia sinistra
        const leftPos = parseFloat(this.trimUI.leftHandle.style.left) || 0;
        if (percentage <= leftPos + 2) return;

        element.style.left = percentage + '%';
        // Calcolo larghezza overlay destro (da destra verso sinistra)
        this.trimUI.rightOverlay.style.width = (100 - percentage) + '%';
      }
    });

    // Fine Drag
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = 'default';
      }
    });
  }

  async trimAudio() {
    if (!this.originalBuffer || !this.trimUI) return;

    const containerRect = this.trimUI.container.getBoundingClientRect();
    const startX = this.trimUI.leftHandle.getBoundingClientRect().left - containerRect.left;
    const endX = this.trimUI.rightHandle.getBoundingClientRect().left - containerRect.left;

    let startRatio = Math.max(0, startX / containerRect.width);
    let endRatio = Math.min(1, endX / containerRect.width);

    const tolerance = 0.01;

    if (startRatio < tolerance) startRatio = 0;

    if (endRatio > (1 - tolerance)) endRatio = 1;

    startRatio = Math.max(0, startRatio);
    endRatio = Math.min(1, endRatio);

    if (startRatio >= endRatio) return;

    if (startRatio === 0 && endRatio === 1) {
      console.log("Nessun taglio selezionato: operazione annullata.");
      return;
    }

    const sampleRate = this.originalBuffer.sampleRate;
    const startFrame = Math.floor(startRatio * this.originalBuffer.length);
    const endFrame = Math.floor(endRatio * this.originalBuffer.length);
    const frameCount = endFrame - startFrame;

    if (frameCount <= 0) return;

    const trimmedBuffer = this.audioContext.createBuffer(
      this.originalBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );

    for (let ch = 0; ch < this.originalBuffer.numberOfChannels; ch++) {
      const channelData = this.originalBuffer.getChannelData(ch);
      trimmedBuffer.copyToChannel(channelData.slice(startFrame, endFrame), ch);
    }

    try {
      const blob = bufferToWave(trimmedBuffer, frameCount);
      const newAudioURL = URL.createObjectURL(blob);

      this.originalBuffer = trimmedBuffer;
      this.currentAudioURL = newAudioURL;

      console.log("Original Buffer Rate:", this.originalBuffer.sampleRate);

      this.regions.clearRegions();
      this.createTrimUI();

      console.log("Ricaricamento Wavesurfer...");
      await this.wavesurfer.load(newAudioURL);

      this.initEqualizer();

    } catch (e) {
      console.error("Errore Trim:", e);
    }
  }

  applyEffectToRegion(region, type) {
    if (!this.originalBuffer) return;

    const buffer = this.originalBuffer;
    // Calcola i frame esatti in base alla posizione della regione
    const startFrame = Math.floor(region.start * buffer.sampleRate);
    const endFrame = Math.floor(region.end * buffer.sampleRate);
    const length = endFrame - startFrame;

    if (length <= 0) return;

    // Modifica diretta del buffer
    if (type === "reverse") {
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channelData = buffer.getChannelData(i);

        // Estrai il pezzo selezionato
        const segment = channelData.subarray(startFrame, endFrame);

        // Creiamo una copia per invertire senza rompere i puntatori
        const reversedSegment = new Float32Array(segment);
        reversedSegment.reverse();

        // Incolla il pezzo invertito al posto dell'originale
        channelData.set(reversedSegment, startFrame);
      }
    }
    // (Qui puoi aggiungere altri if per altri effetti)

    // Ricarica il player con il buffer aggiornato
    this.reloadBuffer(buffer);
  }
}