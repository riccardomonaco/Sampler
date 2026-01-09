import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";
import BeatDetect from "./BeatDetect.js";
import {
  eqBands,
  bufferToWave,
  processRange,
  sliceBuffer,
  makeDistortionCurve
} from "./AudioUtils.js";
import { createBank } from "../ui/Ui.js";
import { Modal } from "../ui/Modal.js";
import { bankService } from "../services/BankService.js";

/**
 * Main AudioPlayer class.
 * Handles WaveSurfer instance, Regions, Audio Context, Effects chain,
 * and user interactions (Mouse, Keyboard, Drag&Drop).
 */
export default class AudioPlayer {
  constructor() {
    // Audio Context Setup
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
      sampleRate: 44100
    });

    // WaveSurfer State
    this.wavesurfer = null;
    this.regions = null;
    this.activeRegion = null;
    this.currentRegion = null;
    this.currentAudioURL = "";
    this.originalBuffer = null;

    // Playback State
    this.isEmpty = true;
    this.isLooping = false;
    this.zoomLevel = 0;

    // Audio Node State
    this.filters = [];
    this.eqInputNode = null;       // EQ Chain Entry Point
    this.previewEffectNode = null; // Node for live Distortion/Bitcrush
    this.delayNode = null;         // Node for live Delay
    this.feedbackNode = null;      // Node for live Delay Feedback
    this.eqInitialized = false;
    this.masterGainNode = null;
    this.previewGainNode = null;

    // Effects State
    this.currentEffectType = null;
    this.effectParams = {};

    // Grid / Magnet State
    this.bpm = 0;
    this.isMagnetOn = false;
    this.quantizeVal = 4;

    // History State
    this.history = [];
    this.redoStack = [];
    this.maxHistory = 10;

    // Beat Detection Config
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

    // Initialization
    this.initWaveSurfer();
    this.setupEventListeners();
    this.initBeatDetect();
  }

  // ===========================================================================
  // WAVESURFER INITIALIZATION & EVENTS
  // ===========================================================================

  /**
   * Initializes or recreates the WaveSurfer instance and Regions plugin.
   */
  initWaveSurfer() {
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
      this.wavesurfer = null;
    }

    this.regions = RegionsPlugin.create();
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

    this.setupZoom();
    this.setupWaveSurferEvents();
  }

  /**
   * Attaches zoom listeners (Mouse Wheel) to the waveform container.
   */
  setupZoom() {
    const container = document.querySelector("#waveform");
    container.addEventListener("wheel", (e) => {
      if (this.wavesurfer) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -50 : 50;
        let currentZoom = this.wavesurfer.options.minPxPerSec || 50;
        let newZoom = Math.max(20, Math.min(currentZoom + delta, 1000));
        this.wavesurfer.zoom(newZoom);
      }
    }, { passive: false });
  }

  /**
   * Binds internal WaveSurfer and Region events.
   */
  setupWaveSurferEvents() {
    this.wavesurfer.on("decode", () => {
      const buffer = this.wavesurfer.getDecodedData();
      if (buffer) {
        this.originalBuffer = buffer;
        requestAnimationFrame(() => this.initEqualizer());
        requestAnimationFrame(() => this.setupKnobListeners());
      }
    });

    this.wavesurfer.on("ready", async () => {
      this.initEqualizer();
      this.createTrimUI();
      await this.detectBPM();

      const plusWrapper = document.getElementById("plus-wrapper");
      if (plusWrapper) plusWrapper.remove();

      this.regions.enableDragSelection({ color: "rgba(165, 165, 165, 0.1)" });
      this.initTrimCurtains();
    });

    this.wavesurfer.on("click", () => this.clearLoop());

    this.wavesurfer.on("finish", () => {
      if (this.isLooping && !this.currentRegion) {
        this.wavesurfer.play();
      }
    });

    this.regions.on("region-created", (region) => {
      if (this.isSystemRegion(region)) return;
      this.handleRegionCreated(region);
    });

    this.regions.on("region-updated", (region) => {
      if (this.isSystemRegion(region)) return;
      this.handleRegionUpdated(region);
      // if (this.isMagnetOn && this.bpm > 0) this.snapRegionToGrid(region);
    });

    this.wavesurfer.on("region-click", (region, e) => {
      if (this.isSystemRegion(region)) return;
      this.handleRegionClick(region, e);
    });

    this.regions.on("region-in", (region) => {
      if (this.isSystemRegion(region)) return;
      this.currentRegion = region;
    });

    this.regions.on("region-out", (region) => {
      if (this.isLooping && this.currentRegion === region) {
        region.play();
      }
    });

    this.regions.on("region-removed", (region) => {
      if (this.activeRegion === region) {
        console.log("Active region deleted: cleaning up effects.");
        this.closeEffectPanel();
      }
    });
  }

  /**
   * Resumes AudioContext if suspended and re-initializes EQ.
   */
  initAudio() {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") return this.audioContext.resume();
    this.initEqualizer();
    return Promise.resolve();
  }

  /**
   * Loads a file blob into the player.
   * @param {string} file - Blob URL.
   */
  async loadAudioFile(file) {
    if (!file) return;
    try {
      await this.wavesurfer.load(file);
    } catch (error) {
      console.error("Load Error:", error);
    }
  }

  /**
   * Reloads the player with a new audio buffer (e.g. after freezing effect).
   * @param {AudioBuffer} buffer 
   */
  async reloadWithBuffer(buffer) {
    const blob = bufferToWave(buffer, buffer.length);
    const url = URL.createObjectURL(blob);

    this.originalBuffer = buffer;
    this.currentAudioURL = url;

    await this.wavesurfer.load(url);
    this.eqInitialized = false;
    this.initEqualizer();
  }

  // ===========================================================================
  // REGION MANAGEMENT
  // ===========================================================================

  /**
   * Checks if a region is a UI curtain or trim handle.
   */
  isSystemRegion(region) {
    return region.id === "left-curtain" || region.id === "right-curtain" || region.id === "trim-region";
  }

  /**
   * Adds custom UI (Close button, Drop logic) to a new region.
   * @param {Object} region 
   */
  handleRegionCreated(region) {
    const regionElement = region.element;

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'region-close-btn';
    deleteBtn.textContent = 'x';
    deleteBtn.title = "Delete Region";

    Object.assign(deleteBtn.style, {
      position: 'absolute',
      top: '5px',
      right: '5px',
      width: '24px',
      height: '24px',
      backgroundColor: '--var(dgrey)',
      color: 'white',
      borderRadius: '0 0 0 4px',
      fontFamily: 'Pixelify Sans, system-ui',
      fontSize: '20px',
      lineHeight: '22px',
      textAlign: 'center',
      cursor: 'pointer',
      zIndex: '10',
      userSelect: 'none'
    });

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.backgroundColor = '--var(dgrey)';
      deleteBtn.style.transform = 'scale(1.2)';
    });

    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.backgroundColor = '--var(lgrey)';
      deleteBtn.style.transform = 'scale(1)';
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      region.remove();
      if (this.currentRegion === region) this.currentRegion = null;
    });

    regionElement.appendChild(deleteBtn);
    this.setupRegionDropZone(region, regionElement);

    region.on("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.isLooping) document.getElementById("loop-button").click();
      this.setCurrentRegion(region);
    });
  }

  /**
   * Configures Drag & Drop behavior on regions for applying effects.
   */
  setupRegionDropZone(region, element) {
    element.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.style.border = "2px solid rgba(255, 255, 255, 0.5)";
      element.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
    });

    element.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.style.border = "0px solid rgba(255, 255, 255, 0.5)";
      element.style.backgroundColor = region.color;
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const dropArea = document.getElementById("waveform");
      if (dropArea) dropArea.classList.remove("dragover");

      element.style.backgroundColor = region.color;
      element.style.border = "none";

      const effectType = e.dataTransfer.getData("effectType");
      if (effectType) {
        // Visual Flash Feedback
        const originalColor = region.color;
        element.style.backgroundColor = "color-mix(in srgb, var(--lgrey) 30%, transparent)";
        setTimeout(() => { if (element) element.style.backgroundColor = originalColor; }, 300);

        // Routing Logic
        if (effectType === "reverse") {
          this.applyDirectEffect(region, "reverse");
        } else if (["distortion", "delay", "bitcrush"].includes(effectType)) {
          this.activateRealTimePreview(region, effectType);
        }
      }
    });
  }

  handleRegionUpdated(region) { }

  handleRegionClick(region, e) {
    e.stopPropagation();
    this.setCurrentRegion(region);
  }

  setCurrentRegion(region) {
    if (this.currentRegion) {
      this.currentRegion.setOptions({ color: "rgba(255, 255, 255, 0.1)" });
      if (this.currentRegion.element) {
        this.currentRegion.element.style.border = "none";
        this.currentRegion.element.style.zIndex = "10";
      }
    }

    this.currentRegion = region;
    region.setOptions({ color: "rgba(255, 255, 255, 0.2)" });

    if (region.element) {
      region.element.style.boxSizing = "border-box";
      region.element.style.border = "1px solid rgba(255, 255, 255, 0.5)";
      region.element.style.zIndex = "100";
    }

    if (this.wavesurfer.isPlaying()) region.play();
  }

  clearLoop() {
    if (!this.currentRegion) return;
    this.currentRegion.setOptions({ color: "rgba(255, 255, 255, 0.1)" });
    if (this.currentRegion.element) {
      this.currentRegion.element.style.border = "none";
      this.currentRegion.element.style.zIndex = "10";
    }
    this.currentRegion = null;
  }

  // ===========================================================================
  // EQUALIZER & AUDIO ROUTING
  // ===========================================================================

  /**
     * Rebuilds the audio node graph including Master Gain.
     * Path: Source -> [Effects] -> EQ -> MasterGain -> Destination.
     */
  initEqualizer() {
    const audio = this.wavesurfer.getMediaElement();
    if (!audio) return;
    audio.crossOrigin = "anonymous";

    if (!this.masterGainNode) {
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = 0.8;
    }
    if (!this.mediaNode) this.mediaNode = this.audioContext.createMediaElementSource(audio);
    if (!this.eqInputNode) this.eqInputNode = this.audioContext.createGain(); // PUNTO DI SOMMA

    if (this.filters.length === 0) {
      this.filters = eqBands.map((band) => {
        const f = this.audioContext.createBiquadFilter();
        f.type = band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
        f.frequency.value = band;
        return f;
      });
      this.connectSliders();
    }

    // DISCONNETTI TUTTO
    try { this.mediaNode.disconnect(); } catch (e) { }
    try { this.eqInputNode.disconnect(); } catch (e) { }
    try { if (this.previewEffectNode) this.previewEffectNode.disconnect(); } catch (e) { }
    try { if (this.delayNode) this.delayNode.disconnect(); } catch (e) { }
    try { if (this.feedbackNode) this.feedbackNode.disconnect(); } catch (e) { }
    try { if (this.previewGainNode) this.previewGainNode.disconnect(); } catch (e) { }
    this.filters.forEach(f => { try { f.disconnect(); } catch (e) { } });
    this.masterGainNode.disconnect();

    // 1. ROUTING VERSO IL PUNTO DI SOMMA (EQ_INPUT)
    if ((this.currentEffectType === 'distortion' || this.currentEffectType === 'bitcrush') && this.previewEffectNode) {
      this.mediaNode.connect(this.previewEffectNode);
      this.previewEffectNode.connect(this.eqInputNode);
    }
    else if (this.currentEffectType === 'delay' && this.delayNode) {
      // Dry
      this.mediaNode.connect(this.eqInputNode);
      // Wet
      this.mediaNode.connect(this.delayNode);
      this.delayNode.connect(this.feedbackNode);
      this.feedbackNode.connect(this.delayNode);
      this.delayNode.connect(this.eqInputNode);
    }
    else {
      // Clean
      this.mediaNode.connect(this.eqInputNode);
    }

    // 2. ROUTING DAL PUNTO DI SOMMA ALL'USCITA
    let chainStart = this.eqInputNode;

    // SE C'È UN EFFETTO, IL VOLUME "FX LEVEL" SI METTE SUBITO DOPO IL SOMMATORE
    if (this.currentEffectType && this.previewGainNode) {
      this.eqInputNode.disconnect();
      this.eqInputNode.connect(this.previewGainNode);
      chainStart = this.previewGainNode;
    }

    let currentNode = chainStart;
    this.filters.forEach((filter) => {
      currentNode.connect(filter);
      currentNode = filter;
    });

    currentNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.audioContext.destination);

    this.eqInitialized = true;
  }
  /**
   * Links HTML range inputs to EQ filter gains.
   */
  connectSliders() {
    const sliders = document.querySelectorAll(".slider-eq");
    sliders.forEach((slider, i) => {
      if (this.filters[i]) {
        this.filters[i].gain.value = slider.value;
        slider.oninput = (e) => {
          this.filters[i].gain.value = e.target.value;
        };
      }
    });
  }

  // ===========================================================================
  // EFFECTS SYSTEM
  // ===========================================================================

  /**
   * Applies synchronous effects (like Reverse) immediately.
   */
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
    } catch (e) { }
  }

  /**
   * Activates live preview for adjustable effects (Distortion, Delay, Bitcrush).
   * Creates necessary AudioNodes and UI controls.
   */
  activateRealTimePreview(region, type) {

    this.closeEffectPanel(); // Pulsce stato precedente
    this.activeRegion = region;
    this.currentEffectType = type;

    // 1. MOSTRA I KNOB
    const knobsRack = document.getElementById("knobs-rack");
    console.log("ciao");
    if (knobsRack) knobsRack.classList.remove("hidden");

    // 2. CREA IL NODO VOLUME ANTEPRIMA
    this.previewGainNode = this.audioContext.createGain();
    const startVol = 0.8;
    this.previewGainNode.gain.value = startVol;
    this.effectParams.volume = startVol;

    // 3. AGGIORNA VISIVAMENTE I KNOB
    const volKnob = document.getElementById('knob-vol');
    if (volKnob) this.updateKnobVisual(volKnob, startVol);
    const volVal = document.getElementById('val-vol');
    if (volVal) volVal.innerText = "80%";

    // SETUP EFFETTI SPECIFICI
    let def1 = 0.5, def2 = 0.5;

    if (type === 'distortion') {
      document.getElementById('label-p1').innerText = "DRIVE";
      document.getElementById('label-p2').innerText = "---";
      this.effectParams.amount = 50;
      def1 = 50 / 400;
      this.previewEffectNode = this.audioContext.createWaveShaper();
      this.previewEffectNode.curve = makeDistortionCurve(this.effectParams.amount);
      this.previewEffectNode.oversample = '4x';
    }
    else if (type === 'delay') {
      document.getElementById('label-p1').innerText = "TIME";
      document.getElementById('label-p2').innerText = "F.BACK";
      this.effectParams.time = 0.25;
      this.effectParams.feedback = 0.4;
      def1 = 0.25; def2 = 0.4 / 0.9;
      this.delayNode = this.audioContext.createDelay(2.0);
      this.delayNode.delayTime.value = 0.25;
      this.feedbackNode = this.audioContext.createGain();
      this.feedbackNode.gain.value = 0.4;
    }
    else if (type === 'bitcrush') {
      document.getElementById('label-p1').innerText = "BITS";
      document.getElementById('label-p2').innerText = "FREQ";
      this.effectParams.bits = 8;
      this.effectParams.normFreq = 0.1;
      def1 = 8 / 16; def2 = 0.1;
      const bs = 4096;
      this.previewEffectNode = this.audioContext.createScriptProcessor(bs, 1, 1);
      this.previewEffectNode.onaudioprocess = (e) => {
        const inp = e.inputBuffer.getChannelData(0);
        const out = e.outputBuffer.getChannelData(0);
        const step = 1 / Math.pow(2, this.effectParams.bits);
        const sSize = Math.floor(1 / this.effectParams.normFreq);
        for (let i = 0; i < bs; i++) out[i] = (i % sSize === 0) ? Math.round(inp[i] / step) * step : (i > 0 ? out[i - 1] : 0);
      };
    }

    this.updateKnobVisual(document.getElementById('knob-p1'), def1);
    this.updateEffectParam(1, def1);

    if (type !== 'distortion') {
      this.updateKnobVisual(document.getElementById('knob-p2'), def2);
      this.updateEffectParam(2, def2);
    } else {
      this.updateKnobVisual(document.getElementById('knob-p2'), 0);
      document.getElementById('val-p2').innerText = "--";
    }

    // 4. CREA IL TASTO APPLY SULLA REGIONE
    const applyBtn = document.createElement('div');
    applyBtn.className = 'region-apply-btn';
    applyBtn.innerText = "APPLY";
    Object.assign(applyBtn.style, {
      position: 'absolute',
      bottom: '50px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'color-mix(in srgb, var(--lgrey), transparent 20%)',   // Verde acceso
      color: 'white',
      border: '2px solid black',
      fontFamily: '"Pixelify Sans", system-ui',
      fontSize: '24px',
      fontWeight: 'bold',
      padding: '2px 8px',
      cursor: 'pointer',
      zIndex: '1000',               // Altissimo
      boxShadow: '2px 2px 0px rgba(0,0,0,0.5)',
      pointerEvents: 'auto',
      whiteSpace: 'nowrap'
    });
    applyBtn.onclick = (e) => {
      e.stopPropagation(); // Evita di riselezionare la regione
      this.freezeCurrentEffect();
    };
    region.element.appendChild(applyBtn);
    this.currentApplyBtn = applyBtn;

    // Ricalcola il percorso audio e avvia il loop
    this.eqInitialized = false;
    this.initEqualizer();
    if (!this.isLooping) {
      document.getElementById("loop-button").click();
    }
    region.play();
  }

  /**
   * Helper: Creates a styled slider element for the Effect UI.
   */
  createSlider(labelText, min, max, step, value, onInput) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "10px";

    const label = document.createElement("span");
    label.innerText = `${labelText}: `;

    const valDisplay = document.createElement("span");
    valDisplay.innerText = value;
    valDisplay.style.marginLeft = "5px";
    valDisplay.style.color = "#aaa";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.style.width = "100%";

    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      valDisplay.innerText = val;
      onInput(val);
    };

    wrapper.appendChild(label);
    wrapper.appendChild(slider);
    wrapper.appendChild(valDisplay);
    return wrapper;
  }

  /**
   * Generates the floating UI panel for effect parameters.
   */
  createEffectControlsUI(type) {
    let container = document.getElementById("effect-controls-wrapper");
    if (!container) {
      container = document.createElement("div");
      container.id = "effect-controls-wrapper";
      Object.assign(container.style, {
        position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
        backgroundColor: "#222", padding: "15px", borderRadius: "8px",
        border: "1px solid #444", color: "white", zIndex: "1000", minWidth: "250px"
      });
      document.body.appendChild(container);
    }

    container.innerHTML = "";
    container.style.display = "block";

    const title = document.createElement("h4");
    title.innerText = type.toUpperCase();
    title.style.margin = "0 0 10px 0";
    container.appendChild(title);

    // --- DYNAMIC SLIDERS ---
    if (type === 'distortion') {
      container.appendChild(this.createSlider("Drive", 0, 400, 1, this.effectParams.amount, (val) => {
        this.effectParams.amount = val;
        if (this.previewEffectNode) this.previewEffectNode.curve = makeDistortionCurve(val);
      }));
    }
    else if (type === 'delay') {
      container.appendChild(this.createSlider("Time (s)", 0.01, 1.0, 0.01, this.effectParams.time, (val) => {
        this.effectParams.time = val;
        if (this.delayNode) this.delayNode.delayTime.linearRampToValueAtTime(val, this.audioContext.currentTime + 0.1);
      }));
      container.appendChild(this.createSlider("Feedback", 0, 0.9, 0.05, this.effectParams.feedback, (val) => {
        this.effectParams.feedback = val;
        if (this.feedbackNode) this.feedbackNode.gain.value = val;
      }));
    }
    else if (type === 'bitcrush') {
      container.appendChild(this.createSlider("Bits", 1, 16, 1, this.effectParams.bits, (val) => {
        this.effectParams.bits = val;
      }));
      container.appendChild(this.createSlider("Freq (Norm)", 0.01, 1, 0.01, this.effectParams.normFreq, (val) => {
        this.effectParams.normFreq = val;
      }));
    }

    // --- BUTTONS ---
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "10px";
    btnContainer.style.marginTop = "15px";

    const freezeBtn = document.createElement("button");
    freezeBtn.innerText = "FREEZE";
    Object.assign(freezeBtn.style, { background: "var(--color-green)", color: "#000", border: "none", padding: "8px 15px", cursor: "pointer", fontWeight: "bold" });
    freezeBtn.onclick = () => this.freezeCurrentEffect();

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "CANCEL";
    Object.assign(cancelBtn.style, { background: "#555", color: "white", border: "none", padding: "8px 15px", cursor: "pointer" });
    cancelBtn.onclick = () => this.closeEffectPanel();

    btnContainer.appendChild(freezeBtn);
    btnContainer.appendChild(cancelBtn);
    container.appendChild(btnContainer);
  }

  /**
   * Freezes the current live effect into the audio buffer permanently.
   */
  async freezeCurrentEffect() {
    if (!this.activeRegion) return;
    try {
      const newBuffer = await processRange(
        this.originalBuffer,
        this.audioContext,
        this.currentEffectType,
        this.activeRegion.start,
        this.activeRegion.end,
        this.effectParams
      );

      // APPLICA IL VOLUME AL BUFFER PRIMA DI SALVARE
      if (newBuffer && this.effectParams.volume !== undefined) {
        const vol = this.effectParams.volume;
        // Calcola indici precisi in base alla regione
        const startSample = Math.floor(this.activeRegion.start * newBuffer.sampleRate);
        const endSample = Math.floor(this.activeRegion.end * newBuffer.sampleRate);

        for (let channel = 0; channel < newBuffer.numberOfChannels; channel++) {
          const data = newBuffer.getChannelData(channel);
          // Modifica solo i campioni dentro la regione
          for (let i = startSample; i < endSample && i < data.length; i++) {
            data[i] = data[i] * vol;
          }
        }
      }

      this.closeEffectPanel(); // Nasconde knob e bottone
      if (newBuffer) await this.reloadWithBuffer(newBuffer);
    } catch (e) {
      console.error("Freeze Error:", e);
    }
  }

  /**
   * Closes effect UI and resets the audio graph to Clean state.
   */
  closeEffectPanel() {
    // 1. TROVA IL RACK E NASCONDILO
    const knobsRack = document.getElementById("knobs-rack");
    if (knobsRack) {
      knobsRack.classList.add("hidden"); // <--- Questo fa sparire i knob
    }

    // 2. RIMUOVI IL TASTO APPLY VERDE
    if (this.currentApplyBtn) {
      this.currentApplyBtn.remove();
      this.currentApplyBtn = null;
    }

    // 3. PULISCI LE VARIABILI AUDIO
    this.previewEffectNode = null;
    this.delayNode = null;
    this.feedbackNode = null;
    this.previewGainNode = null;
    this.activeRegion = null;
    this.currentEffectType = null;

    // Reset delle etichette
    const l1 = document.getElementById('label-p1'); if (l1) l1.innerText = "PARAM 1";
    const l2 = document.getElementById('label-p2'); if (l2) l2.innerText = "PARAM 2";

    // 4. RIPRISTINA L'AUDIO NORMALE
    this.eqInitialized = false;
    this.initEqualizer();
  }

  /**
   * Sets up mouse-drag listeners for the 3 knobs (P1, P2, Vol) 
   * and the Freeze button click.
   */
  setupKnobListeners() {
    // FREEZE BUTTON
    const freezeBtn = document.getElementById("freeze-btn");
    if (freezeBtn) {
      freezeBtn.addEventListener("click", () => this.freezeCurrentEffect());
    }

    // KNOB DRAG LOGIC
    const setupDrag = (knobId, onInput) => {
      const knob = document.getElementById(`knob-${knobId}`);
      if (!knob) return;

      let startY = 0;
      let startVal = 0;

      const onMouseMove = (e) => {
        const delta = startY - e.clientY; // Up = positive
        const sensitivity = 0.005;
        let newVal = startVal + (delta * sensitivity);
        newVal = Math.max(0, Math.min(1, newVal)); // Clamp 0-1

        this.updateKnobVisual(knob, newVal);
        onInput(newVal);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'default';
      };

      knob.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startVal = parseFloat(knob.dataset.value) || 0;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ns-resize';
      });
    };

    // Bind P1 -> Param 1
    setupDrag('p1', (val) => {
      if (!this.currentEffectType) return;
      this.updateEffectParam(1, val);
    });

    // Bind P2 -> Param 2
    setupDrag('p2', (val) => {
      if (!this.currentEffectType) return;
      this.updateEffectParam(2, val);
    });

    // Bind Vol -> Preview Gain
    setupDrag('vol', (val) => {
      if (this.currentEffectType) {
        // QUI avviene il collegamento mentre l'effetto è attivo
        if (this.previewGainNode) this.previewGainNode.gain.value = val;
        this.effectParams.volume = val;
      } else {
        // Se non c'è nessun effetto, controlla il Master Gain generale
        if (this.masterGainNode) this.masterGainNode.gain.value = val;
      }

      const el = document.getElementById('val-vol');
      if (el) el.innerText = Math.round(val * 100) + "%";
    });
  }

  /**
   * Updates the rotation of the visual knob.
   * Maps 0.0-1.0 to -135deg to +135deg.
   */
  updateKnobVisual(knobElement, normalizedValue) {
    knobElement.dataset.value = normalizedValue;
    const deg = (normalizedValue * 270) - 135;
    const indicator = knobElement.querySelector('.knob-indicator');
    if (indicator) {
      indicator.style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    }
  }

  /**
   * Translates normalized knob values (0-1) to actual Audio AudioParams
   * based on the currently active effect type.
   */
  updateEffectParam(knobIndex, normalizedValue) {
    const type = this.currentEffectType;

    if (type === 'distortion') {
      // Knob 1: Drive (0 - 400)
      if (knobIndex === 1) {
        const val = normalizedValue * 400;
        this.effectParams.amount = val;
        document.getElementById('val-p1').innerText = Math.floor(val);
        if (this.previewEffectNode) this.previewEffectNode.curve = makeDistortionCurve(val);
      }
    }
    else if (type === 'delay') {
      // Knob 1: Time (0.01 - 1.0s)
      if (knobIndex === 1) {
        const val = 0.01 + (normalizedValue * 0.99);
        this.effectParams.time = val;
        document.getElementById('val-p1').innerText = val.toFixed(2) + "s";
        if (this.delayNode) this.delayNode.delayTime.linearRampToValueAtTime(val, this.audioContext.currentTime + 0.1);
      }
      // Knob 2: Feedback (0 - 0.9)
      if (knobIndex === 2) {
        const val = normalizedValue * 0.9;
        this.effectParams.feedback = val;
        document.getElementById('val-p2').innerText = Math.floor(val * 100) + "%";
        if (this.feedbackNode) this.feedbackNode.gain.value = val;
      }
    }
    else if (type === 'bitcrush') {
      // Knob 1: Bits (1 = LoFi, 16 = HiFi)
      if (knobIndex === 1) {
        const val = 1 + Math.floor(normalizedValue * 15);
        this.effectParams.bits = val;
        document.getElementById('val-p1').innerText = val + "bit";
      }
      // Knob 2: Freq (0.01 - 1.0)
      if (knobIndex === 2) {
        const val = 0.01 + (normalizedValue * 0.99);
        this.effectParams.normFreq = val;
        document.getElementById('val-p2').innerText = val.toFixed(2) + "x";
      }
    }
  }

  // ===========================================================================
  // TRIM & EDITING TOOLS
  // ===========================================================================

  initTrimCurtains() {
    const duration = this.wavesurfer.getDuration();
    const shadowColor = "rgba(0, 0, 0, 0.65)";
    const handleColor = "var(--color-red)";

    this.regions.getRegions().forEach(r => {
      if (r.id === "left-curtain" || r.id === "right-curtain") r.remove();
    });

    this.leftCurtain = this.regions.addRegion({
      id: "left-curtain", start: 0, end: 0, color: shadowColor,
      drag: false, resize: true, loop: false,
      handleStyle: { left: { display: "none" }, right: { backgroundColor: handleColor, width: "4px", opacity: "1", zIndex: "10" } }
    });

    this.rightCurtain = this.regions.addRegion({
      id: "right-curtain", start: duration, end: duration, color: shadowColor,
      drag: false, resize: true, loop: false,
      handleStyle: { left: { backgroundColor: handleColor, width: "4px", opacity: "1", zIndex: "10" }, right: { display: "none" } }
    });
  }

  createTrimUI() {
    const container = document.getElementById("waveform");
    container.querySelectorAll('.trim-ui-element').forEach(el => el.remove());

    this.trimUI = { container };

    this.trimUI.leftOverlay = document.createElement('div');
    this.trimUI.leftOverlay.className = 'trim-overlay trim-ui-element';
    this.trimUI.leftOverlay.style.cssText = "left: 0; width: 0%;";

    this.trimUI.rightOverlay = document.createElement('div');
    this.trimUI.rightOverlay.className = 'trim-overlay trim-ui-element';
    this.trimUI.rightOverlay.style.cssText = "right: 0; width: 0%;";

    this.trimUI.leftHandle = document.createElement('div');
    this.trimUI.leftHandle.className = 'trim-handle trim-handle-left trim-ui-element';
    this.trimUI.leftHandle.innerText = "|";
    this.trimUI.leftHandle.style.left = '0%';

    this.trimUI.rightHandle = document.createElement('div');
    this.trimUI.rightHandle.className = 'trim-handle trim-handle-right trim-ui-element';
    this.trimUI.rightHandle.innerText = "|";
    this.trimUI.rightHandle.style.cssText = "left: 100%; transform: translateX(-100%);";

    container.append(this.trimUI.leftOverlay, this.trimUI.rightOverlay, this.trimUI.leftHandle, this.trimUI.rightHandle);
    this.enableDrag(this.trimUI.leftHandle, 'left');
    this.enableDrag(this.trimUI.rightHandle, 'right');
  }

  enableDrag(element, type) {
    let isDragging = false;

    element.addEventListener('mousedown', (e) => {
      isDragging = true;
      e.stopPropagation();
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const rect = this.trimUI.container.getBoundingClientRect();
      let x = e.clientX - rect.left;
      if (x < 0) x = 0;
      if (x > rect.width) x = rect.width;

      const percentage = (x / rect.width) * 100;

      if (type === 'left') {
        const rightPos = parseFloat(this.trimUI.rightHandle.style.left) || 100;
        if (percentage >= rightPos - 2) return;
        element.style.left = percentage + '%';
        this.trimUI.leftOverlay.style.width = percentage + '%';
      } else {
        const leftPos = parseFloat(this.trimUI.leftHandle.style.left) || 0;
        if (percentage <= leftPos + 2) return;
        element.style.left = percentage + '%';
        this.trimUI.rightOverlay.style.width = (100 - percentage) + '%';
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = 'default';
      }
    });
  }

  async trimAudio() {
    if (!this.originalBuffer || !this.trimUI) return;

    let startVal = parseFloat(this.trimUI.leftHandle.style.left) || 0;

    let endVal = parseFloat(this.trimUI.rightHandle.style.left);
    if (isNaN(endVal)) endVal = 100; // Sicurezza se lo stile non fosse ancora settato

    // Converti in ratio 0.0 -> 1.0
    let startRatio = startVal / 100;
    let endRatio = endVal / 100;

    const tolerance = 0.001;
    if (startRatio < tolerance) startRatio = 0;
    if (endRatio > (1 - tolerance)) endRatio = 1;

    if (startRatio >= endRatio) return;
    if (startRatio === 0 && endRatio === 1) return; // Nessun taglio necessario
    // ---------------------

    const startFrame = Math.floor(startRatio * this.originalBuffer.length);
    const endFrame = Math.floor(endRatio * this.originalBuffer.length);

    if (endFrame - startFrame <= 0) return;

    const trimmedBuffer = sliceBuffer(
      this.originalBuffer,
      startRatio, // Usa startRatio pulito
      endRatio,   // Usa endRatio pulito
      this.audioContext
    );

    if (trimmedBuffer) {
      await this.reloadWithBuffer(trimmedBuffer);
      this.regions.clearRegions();
      this.createTrimUI();
    }
  }

  // ===========================================================================
  // BPM & MAGNET TOOLS
  // ===========================================================================

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

        if (now - this.lastTapTime <= 2000) {
          bpmLed.classList.remove("bpm-led-locked");
          this.bpm = Math.round(bpm);
          bpmLed.textContent = this.bpm + " BPM";
        }
        this.lastTapTime = now;
        this.lockTimer = setTimeout(() => bpmLed.classList.add("bpm-led-locked"), 2000);
      },
    });
  }

  async detectBPM() {
    this.beatDetect.getBeatInfo({ url: this.currentAudioURL })
      .then((info) => {
        this.bpm = Math.round(info.bpm);
        document.getElementById("bpm-led").textContent = this.bpm + " BPM";
      })
      .catch((error) => { /* Handle error silently */ });
  }

  initMagnetUI() {
    const bpmWrapper = document.querySelector(".bpm-led-wrapper");
    if (!bpmWrapper) return;

    const magnetContainer = document.createElement("div");
    magnetContainer.style.cssText = "display:flex; align-items:center; gap:5px; margin-top:10px; justify-content:center;";

    const magnetBtn = document.createElement("div");
    magnetBtn.innerHTML = '<i class="fa-solid fa-magnet"></i>';
    magnetBtn.title = "Toggle Snap to Grid";
    magnetBtn.style.cssText = "cursor:pointer; padding:5px 10px; border-radius:4px; color:#555; border:1px solid #555; fontSize:18px;";

    magnetBtn.onclick = () => {
      this.isMagnetOn = !this.isMagnetOn;
      const activeColor = this.isMagnetOn ? "var(--color-green)" : "#555";
      magnetBtn.style.color = activeColor;
      magnetBtn.style.borderColor = activeColor;
    };

    const quantizeSelect = document.createElement("select");
    quantizeSelect.style.cssText = "background-color:#222; color:white; border:1px solid #444; border-radius:4px; padding:2px; fontFamily:Pixelify Sans;";

    [2, 4, 8, 16].forEach(val => {
      const el = document.createElement("option");
      el.value = val;
      el.innerText = `1/${val}`;
      if (val === 4) el.selected = true;
      quantizeSelect.appendChild(el);
    });

    quantizeSelect.onchange = (e) => this.quantizeVal = parseInt(e.target.value);
    magnetContainer.append(magnetBtn, quantizeSelect);
    bpmWrapper.appendChild(magnetContainer);
  }

  snapRegionToGrid(region) {
    const activeBpm = this.bpm > 0 ? this.bpm : 120;
    const beatDuration = 60 / activeBpm;
    const gridSize = beatDuration * (4 / this.quantizeVal);

    const snappedStart = Math.round(region.start / gridSize) * gridSize;
    let snappedEnd = Math.round(region.end / gridSize) * gridSize;

    if (snappedEnd <= snappedStart) snappedEnd = snappedStart + gridSize;

    if (Math.abs(region.start - snappedStart) > 0.001 || Math.abs(region.end - snappedEnd) > 0.001) {
      region.setOptions({ start: snappedStart, end: snappedEnd });
    }
  }

  setupBpmInput() {
    const bpmLed = document.getElementById("bpm-led");
    if (!bpmLed) return;

    // EVENTO: TASTO DESTRO (contextmenu) per EDITARE
    bpmLed.addEventListener("contextmenu", (e) => {
      e.preventDefault(); // Blocca il menu a tendina del browser
      e.stopPropagation();

      if (bpmLed.querySelector("input")) return;

      const currentText = bpmLed.innerText.replace(" BPM", "");
      const currentVal = parseInt(currentText) || this.bpm || 120;

      bpmLed.innerHTML = "";
      const input = document.createElement("input");
      input.classList.add("BPM_input");
      input.type = "number";
      input.value = currentVal;
      input.style.cssText = "width:60px; background:transparent; color:inherit; border:none; font-family:inherit; font-size:inherit; text-align:center; outline:none;";

      bpmLed.appendChild(input);
      input.focus();
      input.select();

      const saveBpm = () => {
        let newVal = parseInt(input.value);
        if (newVal && newVal > 0) this.bpm = newVal;
        bpmLed.innerText = this.bpm + " BPM";
        bpmLed.classList.remove("bpm-led-locked");
      };

      input.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBpm(); });
      input.addEventListener("blur", () => saveBpm());
    });
  }

  // ===========================================================================
  // UI EVENT LISTENERS
  // ===========================================================================

  setupEventListeners() {
    document.getElementById("play-button").addEventListener("click", () => this.wavesurfer.play());
    document.getElementById("pause-button").addEventListener("click", () => this.wavesurfer.pause());
    document.getElementById("stop-button").addEventListener("click", () => {
      if (this.isLooping) this.wavesurfer.seekTo(0);
      this.wavesurfer.stop();
    });

    document.getElementById("loop-button").addEventListener("click", () => {
      this.isLooping = !this.isLooping;
      document.getElementById("loop-button").classList.toggle("old-button-loop");
    });

    document.getElementById("x2-button").addEventListener("click", () => {
      if (this.isLooping && this.currentRegion) {
        this.regions.clearRegions();
        this.regions.addRegion({
          start: this.currentRegion.start,
          end: this.currentRegion.start + (this.currentRegion.end - this.currentRegion.start) * 2,
          loop: true, color: "rgba(165, 165, 165, 0.1)",
          handleStyle: { left: "rgba(0, 150, 255, 0.9)", right: "rgba(0, 150, 255, 0.9)" },
        });
      }
    });

    document.getElementById("d2-button").addEventListener("click", () => {
      if (this.isLooping && this.currentRegion) {
        this.wavesurfer.seekTo(this.currentRegion.start);
        this.regions.clearRegions();
        this.regions.addRegion({
          start: this.currentRegion.start,
          end: this.currentRegion.start + (this.currentRegion.end - this.currentRegion.start) / 2,
          loop: true, color: "rgba(165, 165, 165, 0.3)",
          handleStyle: { left: "rgba(0, 150, 255, 0.9)", right: "rgba(0, 150, 255, 0.9)" },
        });
      }
    });

    document.getElementById('trim-btn').addEventListener('click', () => this.trimAudio());

    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === " ") this.wavesurfer.playPause();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        this.redo();
      }
    });

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportAudio();

        const originalColor = exportBtn.style.color;
        exportBtn.style.color = "var(--lgrey)";
        setTimeout(() => {
          exportBtn.style.color = "";
        }, 200);
      });
    }

    const saveBankBtn = document.getElementById('save-bank-btn');
    if (saveBankBtn) {
      saveBankBtn.addEventListener('click', () => {
        this.saveToCurrentBank();

        const originalColor = saveBankBtn.style.color;
        saveBankBtn.style.color = "var(--color-green)";
        setTimeout(() => {
          saveBankBtn.style.color = "";
        }, 300);
      });
    }

    this.setupGlobalDragDrop();
    this.setupBpmInput();
  }

  setupGlobalDragDrop() {
    const dropArea = document.getElementById("waveform");

    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      const types = e.dataTransfer.types;
      if (types.includes("effecttype") || types.includes("effectType")) return;
      dropArea.classList.add("dragover");
    });

    dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragover"));

    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("dragover");

      const effectType = e.dataTransfer.getData("effectType");
      if (effectType) return;

      const type = e.dataTransfer.getData("type");
      const url = e.dataTransfer.getData("audioUrl");

      if (type === "sample" && url) {
        this.wavesurfer.load(url);
        this.currentAudioURL = url;
      } else if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file) {
          const objectUrl = URL.createObjectURL(file);
          this.loadAudioFile(objectUrl);
          this.currentAudioURL = objectUrl;
        }
      }
    });

    document.addEventListener('dragstart', (e) => {
      const targetIcon = e.target.closest ? e.target.closest('.fx-img') : null;
      if (targetIcon) {
        const effect = targetIcon.getAttribute('data-effect');
        if (effect) {
          e.dataTransfer.setData("effectType", effect);
          e.dataTransfer.effectAllowed = "copy";
        }
      }
    });
  }

  // ===========================================================================
  // HISTORY MANAGEMENT
  // ===========================================================================

  addToHistory(url) {
    this.history.push(url);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.history.length === 0) return;
    this.redoStack.push(this.currentAudioURL);
    const previousUrl = this.history.pop();
    this.wavesurfer.load(previousUrl);
    this.currentAudioURL = previousUrl;
    this.regions.clearRegions();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.history.push(this.currentAudioURL);
    const nextUrl = this.redoStack.pop();
    this.wavesurfer.load(nextUrl);
    this.currentAudioURL = nextUrl;
  }

  /**
   * Helper: Genera il Blob WAV applicando EQ e Master Volume correnti.
   * Restituisce il Blob pronto per essere scaricato o caricato.
   */
  async getProcessedWavBlob() {
    if (!this.originalBuffer) return null;

    // 1. Setup Offline Context (Mixer Virtuale)
    const offlineCtx = new OfflineAudioContext(
      this.originalBuffer.numberOfChannels,
      this.originalBuffer.length,
      this.originalBuffer.sampleRate
    );

    // 2. Sorgente
    const source = offlineCtx.createBufferSource();
    source.buffer = this.originalBuffer;

    // 3. Ricostruzione Catena EQ + Volume
    let currentNode = source;
    const currentGains = this.filters.map(f => f.gain.value);

    eqBands.forEach((band, i) => {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
      filter.frequency.value = band;
      filter.gain.value = currentGains[i];
      currentNode.connect(filter);
      currentNode = filter;
    });

    // 4. Master Volume
    if (this.masterGainNode) {
      const masterGain = offlineCtx.createGain();
      masterGain.gain.value = this.masterGainNode.gain.value;
      currentNode.connect(masterGain);
      currentNode = masterGain;
    }

    // 5. Render
    currentNode.connect(offlineCtx.destination);
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();

    // 6. Conversione in WAV Blob
    return bufferToWave(renderedBuffer, renderedBuffer.length);
  }

  /**
     * Export the current buffer applying EQ and Master Volume (WYSIWYG).
     */
  async exportAudio() {
    const blob = await this.getProcessedWavBlob();
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    let defaultName = "My_wild_sample001";
    let sampleName = await Modal.show('prompt', "Name your new sample:", defaultName);
    a.download = sampleName;
    if (sampleName) {
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  }

  async saveToCurrentBank() {
    const bankSelect = document.getElementById("banks");
    const currentBank = bankSelect ? bankSelect.value : null;

    if (!this.originalBuffer) {
      await Modal.show('alert', "Nessun sample caricato!");
      return;
    }
    if (!currentBank || currentBank === "" || currentBank === "__NEW_BANK__") {
      await Modal.show('alert', "Seleziona una soundbank valida!");
      return;
    }

    const btn = document.getElementById("save-bank-btn");
    const originalIcon = btn.innerHTML;
    btn.innerHTML = `<i class="pixelart-icons-font-clock"></i>`;
    btn.style.pointerEvents = "none";

    try {
      const wavBlob = await this.getProcessedWavBlob();

      let defaultName = "Rename your sample";

      let sampleName = await Modal.show('prompt', "Name your new sample:", defaultName);
      if (!sampleName) throw new Error("Salvataggio annullato");

      const colors = ["var(--color-red)", "var(--color-ambra)", "var(--color-green)", "var(--color-blu)"];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      await bankService.addSample(currentBank, sampleName, wavBlob, randomColor);

      createBank(currentBank);
      await Modal.show('alert', "Sample salvato nella bank!");

    } catch (error) {
      if (error.message !== "Salvataggio annullato") {
        console.error(error);
        alert("Errore durante il salvataggio.");
      }
    } finally {
      btn.innerHTML = originalIcon;
      btn.style.pointerEvents = "auto";
    }
  }
}