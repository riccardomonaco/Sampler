import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";
import BeatDetect from "./BeatDetect.js";

// AudioPlayer.js - In cima
import { eqBands, bufferToWave, processRange, sliceBuffer, makeDistortionCurve, soundBanks } from "./AudioUtils.js";

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

    this.eqInputNode = null;       // Punto di ingresso catena EQ
    this.previewEffectNode = null; // Nodo effetto temporaneo (es. Distorsione Live)
    this.activeRegion = null;      // Regione su cui stiamo lavorando
    this.currentEffectType = null; // Tipo di effetto corrente
    this.effectParams = {};

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

    document.addEventListener('dragstart', (e) => {
      // 1. Logga QUALSIASI cosa venga trascinata per vedere se l'evento parte
      console.log("🔥 Dragstart intercettato su:", e.target);

      // 2. Usa .closest() per trovare l'icona anche se clicchi su un bordo o un elemento interno
      const targetIcon = e.target.closest ? e.target.closest('.fx-img') : null;

      if (targetIcon) {
        const effect = targetIcon.getAttribute('data-effect');
        console.log("✅ Trovata icona effetto:", effect);

        if (effect) {
          e.dataTransfer.setData("effectType", effect);
          e.dataTransfer.effectAllowed = "copy";
        }
      } else {
        console.log("❌ L'elemento trascinato NON è un effetto (.fx-img)");
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
      // --- LOGICA DROP EFFETTI --- all'interno di handleRegionCreated
      regionElement.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const effectType = e.dataTransfer.getData("effectType");
        console.log(effectType);

        if (effectType) {
          console.log(`Drop effetto rilevato: ${effectType}`);

          // Flash Verde Feedback
          regionElement.style.backgroundColor = "rgba(0, 255, 0, 0.8)";
          setTimeout(() => regionElement.style.backgroundColor = region.color, 300);

          // SMISTAMENTO EFFETTI
          if (effectType === "reverse") {
            // Effetto istantaneo (Matematico)
            this.applyDirectEffect(region, "reverse");
          }
          else if (effectType === "distortion") {
            // Effetto con Preview (Real-time Knob)
            this.activateRealTimePreview(region, "distortion");
          }
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

    audio.crossOrigin = "anonymous";

    // 1. Evita di ricreare nodi se l'EQ è già attivo e i nodi esistono
    if (this.eqInitialized && this.mediaNode && this.eqInputNode) {
      // Se c'è un effetto preview attivo, potremmo dover ricollegare, 
      // ma per sicurezza lasciamo che la logica di disconnessione sotto gestisca tutto se chiamata.
      // Se tutto è stabile, usciamo.
      if (!this.previewEffectNode) return;
    }

    // 2. Crea i nodi base se mancano
    if (!this.mediaNode) {
      this.mediaNode = this.audioContext.createMediaElementSource(audio);
    }

    // Nodo "collo di bottiglia" che entra nell'EQ. 
    // Source -> [PreviewEffect?] -> EqInputNode -> Filtri -> Speakers
    if (!this.eqInputNode) {
      this.eqInputNode = this.audioContext.createGain();
    }

    // 3. Crea i filtri (se non esistono)
    if (this.filters.length === 0) {
      this.filters = eqBands.map((band) => {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
        filter.gain.value = 0;
        filter.Q.value = 1;
        filter.frequency.value = band;
        return filter;
      });
      this.connectSliders();
    }


    // 4. DISCONNETTI TUTTO (Reset pulito)
    try { this.mediaNode.disconnect(); } catch (e) { }
    try { if (this.previewEffectNode) this.previewEffectNode.disconnect(); } catch (e) { }
    try { this.eqInputNode.disconnect(); } catch (e) { }
    this.filters.forEach(f => { try { f.disconnect(); } catch (e) { } });

    // 5. ROUTING DINAMICO
    // Se c'è un effetto live (es. Distorsione mentre muovi lo slider), passa di lì
    if (this.previewEffectNode) {
      this.mediaNode.connect(this.previewEffectNode);
      this.previewEffectNode.connect(this.eqInputNode);
    } else {
      // Altrimenti vai dritto all'EQ
      this.mediaNode.connect(this.eqInputNode);
    }

    // 6. Collega Catena EQ
    let currentNode = this.eqInputNode;
    this.filters.forEach((filter) => {
      currentNode.connect(filter);
      currentNode = filter;
    });

    currentNode.connect(this.audioContext.destination);

    this.eqInitialized = true;
    console.log("Catena Audio Aggiornata (EQ + Effects Routing)");
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

    const trimmedBuffer = sliceBuffer(
      this.originalBuffer,
      startRatio,
      endRatio,
      this.audioContext
    );

    if (!trimmedBuffer) return;

    try {
      // Usa il nuovo helper per ricaricare
      await this.reloadWithBuffer(trimmedBuffer);

      // Reset specifico per il trim
      this.regions.clearRegions();
      this.createTrimUI();

    } catch (e) {
      console.error("Errore Trim:", e);
    }
  }

  // --- GESTIONE EFFETTI ---

  // 1. Applica effetti immediati (Reverse) usando il router di AudioUtils
  async applyDirectEffect(region, type) {
    if (!this.originalBuffer) return;

    try {
      const newBuffer = await processRange(
        this.originalBuffer,
        this.audioContext,
        type,
        region.start,
        region.end
      );

      if (newBuffer) await this.reloadWithBuffer(newBuffer);
    } catch (e) {
      console.error("Errore effetto diretto:", e);
    }
  }

  // 2. Attiva la modalità Preview Live (per Distortion, Delay, ecc.)
  activateRealTimePreview(region, type) {
    // Pulisci eventuali pannelli aperti
    this.closeEffectPanel();

    this.activeRegion = region;
    this.currentEffectType = type;
    this.effectParams = { amount: 50 }; // Valore default generico

    // Crea il nodo WebAudio per la preview LIVE
    if (type === 'distortion') {
      this.previewEffectNode = this.audioContext.createWaveShaper();
      this.previewEffectNode.curve = makeDistortionCurve(this.effectParams.amount);
      this.previewEffectNode.oversample = '4x';
    }

    // Ricollega l'audio: Source -> PreviewNode -> EQ -> Speakers
    this.eqInitialized = false; // Forza ricalcolo routing
    this.initEqualizer();

    // Metti in loop la regione per sentire le modifiche
    region.playLoop();

    // Mostra i controlli a schermo
    this.createEffectControlsUI(type);
  }

  // 3. Crea l'interfaccia (Slider e Tasti)
  createEffectControlsUI(type) {
    // Assicurati di avere un <div id="effect-controls-container"></div> nel tuo HTML
    // Se non c'è, lo creiamo al volo appeso al body per test
    let container = document.getElementById("effect-controls-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "effect-controls-container";
      container.style.position = "fixed";
      container.style.bottom = "20px";
      container.style.left = "50%";
      container.style.transform = "translateX(-50%)";
      container.style.backgroundColor = "#222";
      container.style.padding = "15px";
      container.style.borderRadius = "8px";
      container.style.border = "1px solid #444";
      container.style.color = "white";
      container.style.zIndex = "1000";
      document.body.appendChild(container);
    }

    container.innerHTML = "";
    container.style.display = "block";

    const title = document.createElement("h4");
    title.innerText = type.toUpperCase();
    title.style.margin = "0 0 10px 0";
    container.appendChild(title);

    // --- SLIDER (Knob) ---
    if (type === 'distortion') {
      const wrapper = document.createElement("div");
      wrapper.style.marginBottom = "10px";

      const label = document.createElement("span");
      label.innerText = "Drive: ";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "400"; // Più alto = più distorto
      slider.value = this.effectParams.amount;

      // EVENTO REAL TIME: Modifica il nodo audio mentre muovi
      slider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        this.effectParams.amount = val;

        if (this.previewEffectNode) {
          this.previewEffectNode.curve = makeDistortionCurve(val);
        }
      };

      wrapper.appendChild(label);
      wrapper.appendChild(slider);
      container.appendChild(wrapper);
    }

    // --- TASTI ACTION ---
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "10px";

    const freezeBtn = document.createElement("button");
    freezeBtn.innerText = "APPLY (Freeze)";
    freezeBtn.style.background = "green";
    freezeBtn.style.color = "white";
    freezeBtn.style.border = "none";
    freezeBtn.style.padding = "5px 10px";
    freezeBtn.style.cursor = "pointer";

    freezeBtn.onclick = () => this.freezeCurrentEffect();

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "Cancel";
    cancelBtn.style.background = "#555";
    cancelBtn.style.color = "white";
    cancelBtn.style.border = "none";
    cancelBtn.style.padding = "5px 10px";
    cancelBtn.style.cursor = "pointer";

    cancelBtn.onclick = () => this.closeEffectPanel();

    btnContainer.appendChild(freezeBtn);
    btnContainer.appendChild(cancelBtn);
    container.appendChild(btnContainer);
  }

  // 4. Applica Definitivo (Renderizza Offline e Sostituisce)
  async freezeCurrentEffect() {
    if (!this.previewEffectNode || !this.activeRegion) return;

    console.log("Freezing effect...");

    try {
      // Chiama AudioUtils per fare il rendering pesante
      const newBuffer = await processRange(
        this.originalBuffer,
        this.audioContext,
        this.currentEffectType,
        this.activeRegion.start,
        this.activeRegion.end,
        this.effectParams
      );

      // Chiudi UI e pulisci nodi live
      this.closeEffectPanel();

      // Ricarica il player col nuovo buffer "stampato"
      if (newBuffer) await this.reloadWithBuffer(newBuffer);

    } catch (e) {
      console.error("Errore Freeze:", e);
    }
  }

  // 5. Chiudi Pannello e Pulisci
  closeEffectPanel() {
    const container = document.getElementById("effect-controls-container");
    if (container) container.style.display = "none";

    this.previewEffectNode = null;
    this.activeRegion = null;
    this.currentEffectType = null;

    // Ripristina routing pulito (toglie il nodo preview dalla catena)
    this.eqInitialized = false;
    this.initEqualizer();
  }

  // --- HELPER DI RICARICAMENTO ---
  async reloadWithBuffer(buffer) {
    // Usa bufferToWave da AudioUtils
    const blob = bufferToWave(buffer, buffer.length);
    const url = URL.createObjectURL(blob);

    this.originalBuffer = buffer;
    this.currentAudioURL = url;

    // Opzionale: pulire regioni o mantenerle
    // this.regions.clearRegions(); 
    // this.createTrimUI();

    console.log("Reloading Wavesurfer with processed buffer...");
    await this.wavesurfer.load(url);

    // Importante: ricollegare l'EQ dopo il load
    this.eqInitialized = false;
    this.initEqualizer();
  }
}
