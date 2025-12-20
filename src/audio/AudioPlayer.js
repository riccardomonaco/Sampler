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

/**
 * Main class handling audio playback, waveform visualization,
 * regions, effects processing, and user interaction.
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
    this.eqInputNode = null;       // EQ Chain Entry
    this.previewEffectNode = null; // Live Effect Node
    this.eqInitialized = false;

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
   * Destroys existing WaveSurfer instance (if any) and creates a new one
   * with Region plugin and visual configurations.
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
   * Attaches wheel event listeners to the container for waveform zooming.
   * Constrains zoom level between 20 and 1000 px/sec.
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
   * Binds WaveSurfer lifecycle events (decode, ready, finish)
   * and Region plugin events (created, updated, clicked).
   */
  setupWaveSurferEvents() {
    // Decoding finished
    this.wavesurfer.on("decode", () => {
      const buffer = this.wavesurfer.getDecodedData();
      if (buffer) {
        this.originalBuffer = buffer;
        requestAnimationFrame(() => this.initEqualizer());
      }
    });

    // Player Ready
    this.wavesurfer.on("ready", async () => {
      this.initEqualizer();
      this.createTrimUI();
      this.initMagnetUI();
      await this.detectBPM();
      
      const plusWrapper = document.getElementById("plus-wrapper");
      if (plusWrapper) plusWrapper.remove();

      this.regions.enableDragSelection({ color: "rgba(165, 165, 165, 0.1)" });
      this.initTrimCurtains();
    });

    // Playback Events
    this.wavesurfer.on("click", () => this.clearLoop());
    
    this.wavesurfer.on("finish", () => {
      if (this.isLooping && !this.currentRegion) {
        this.wavesurfer.play();
      }
    });

    // Region Events
    this.regions.on("region-created", (region) => {
      if (this.isSystemRegion(region)) return;
      this.handleRegionCreated(region);
    });

    this.regions.on("region-updated", (region) => {
      if (this.isSystemRegion(region)) return;
      this.handleRegionUpdated(region);
      if (this.isMagnetOn && this.bpm > 0) this.snapRegionToGrid(region);
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
  }

  /**
   * Resumes AudioContext if suspended and ensures Equalizer is initialized.
   * @returns {Promise<void>}
   */
  initAudio() {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") return this.audioContext.resume();
    this.initEqualizer();
    return Promise.resolve();
  }

  /**
   * Loads an audio file from a Blob/File URL into WaveSurfer.
   * @param {string} file - The object URL of the file.
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
   * Converts a processed AudioBuffer into a blob and reloads the player logic.
   * Used after destructive edits (trim, freeze effect).
   * @param {AudioBuffer} buffer - The modified audio buffer.
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
   * Determines if a region is a UI element (curtains/trim) rather than a user region.
   * @param {Object} region - The region to check.
   * @returns {boolean} True if system region.
   */
  isSystemRegion(region) {
    return region.id === "left-curtain" || region.id === "right-curtain" || region.id === "trim-region";
  }

  /**
   * Configures a newly created region with a custom delete button
   * and drag-and-drop effect capabilities.
   * @param {Object} region - The region object.
   */
  handleRegionCreated(region) {
    const regionElement = region.element;

    // Create Delete Button
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

    // Setup Drag/Drop Events for Effects
    this.setupRegionDropZone(region, regionElement);

    region.on("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.isLooping) document.getElementById("loop-button").click();
      this.setCurrentRegion(region);
    });
  }

  /**
   * Sets up drag events on a region element to accept dropped effects.
   * @param {Object} region - The region object.
   * @param {HTMLElement} element - The DOM element of the region.
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

        // Apply Logic
        if (effectType === "reverse") {
          this.applyDirectEffect(region, "reverse");
        } else if (effectType === "distortion") {
          this.activateRealTimePreview(region, "distortion");
        }
      }
    });
  }

  /**
   * Callback for region updates. (Currently unused logic hook).
   * @param {Object} region 
   */
  handleRegionUpdated(region) {
    // Logic for logging updates can go here if needed
  }

  /**
   * Handles click interaction on a region, setting it as active.
   * @param {Object} region 
   * @param {Event} e 
   */
  handleRegionClick(region, e) {
    e.stopPropagation();
    this.setCurrentRegion(region);
  }

  /**
   * Sets the visual state (color, z-index) for the currently selected region.
   * @param {Object} region - The selected region.
   */
  setCurrentRegion(region) {
    // Deselect current
    if (this.currentRegion) {
      this.currentRegion.setOptions({ color: "rgba(255, 255, 255, 0.1)" });
      if (this.currentRegion.element) {
        this.currentRegion.element.style.border = "none";
        this.currentRegion.element.style.zIndex = "10";
      }
    }

    this.currentRegion = region;

    // Select new
    region.setOptions({ color: "rgba(255, 255, 255, 0.2)" });
    if (region.element) {
      region.element.style.boxSizing = "border-box";
      region.element.style.border = "1px solid rgba(255, 255, 255, 0.5)";
      region.element.style.zIndex = "100";
    }

    if (this.wavesurfer.isPlaying()) {
      region.play();
    }
  }

  /**
   * Clears the currently active region selection and loop state.
   */
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
   * Initializes the Web Audio API graph.
   * Routing: Source -> [PreviewEffect?] -> EQ -> Destination.
   * Re-runs dynamically when effects are enabled/disabled.
   */
  initEqualizer() {
    const audio = this.wavesurfer.getMediaElement();
    if (!audio) return;

    audio.crossOrigin = "anonymous";

    // Avoid recreation if preview is active to prevent glitches
    if (this.eqInitialized && this.mediaNode && this.eqInputNode && this.previewEffectNode) return;

    // Create Base Nodes
    if (!this.mediaNode) this.mediaNode = this.audioContext.createMediaElementSource(audio);
    if (!this.eqInputNode) this.eqInputNode = this.audioContext.createGain();

    // Create Filters if missing
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

    // Disconnect everything
    try { this.mediaNode.disconnect(); } catch (e) { }
    try { if (this.previewEffectNode) this.previewEffectNode.disconnect(); } catch (e) { }
    try { this.eqInputNode.disconnect(); } catch (e) { }
    this.filters.forEach(f => { try { f.disconnect(); } catch (e) { } });

    // Routing Logic
    if (this.previewEffectNode) {
      // With Live Effect: Source -> Preview -> EQ -> Dest
      this.mediaNode.connect(this.previewEffectNode);
      this.previewEffectNode.connect(this.eqInputNode);
    } else {
      // Normal: Source -> EQ -> Dest
      this.mediaNode.connect(this.eqInputNode);
    }

    // Connect EQ Chain
    let currentNode = this.eqInputNode;
    this.filters.forEach((filter) => {
      currentNode.connect(filter);
      currentNode = filter;
    });

    currentNode.connect(this.audioContext.destination);
    this.eqInitialized = true;
  }

  /**
   * Connects HTML range sliders to the EQ Gain nodes.
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
   * Applies a destructive effect immediately (e.g., Reverse).
   * @param {Object} region - The region to process.
   * @param {string} type - The effect type (e.g., 'reverse').
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
   * Activates a real-time listening preview for effects (e.g., Distortion).
   * Reroutes audio through a temporary effect node.
   * @param {Object} region - The region to preview.
   * @param {string} type - The effect type.
   */
  activateRealTimePreview(region, type) {
    this.closeEffectPanel();

    this.activeRegion = region;
    this.currentEffectType = type;
    this.effectParams = { amount: 50 };

    if (type === 'distortion') {
      this.previewEffectNode = this.audioContext.createWaveShaper();
      this.previewEffectNode.curve = makeDistortionCurve(this.effectParams.amount);
      this.previewEffectNode.oversample = '4x';
    }

    // Re-route audio
    this.eqInitialized = false;
    this.initEqualizer();
    region.playLoop();
    this.createEffectControlsUI(type);
  }

  /**
   * Builds the DOM UI for controlling live effect parameters (sliders/buttons).
   * @param {string} type - The effect type to display controls for.
   */
  createEffectControlsUI(type) {
    let container = document.getElementById("effect-controls-wrapper");
    if (!container) {
      container = document.createElement("div");
      container.id = "effect-controls-wrapper";
      Object.assign(container.style, {
        position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
        backgroundColor: "#222", padding: "15px", borderRadius: "8px",
        border: "1px solid #444", color: "white", zIndex: "1000"
      });
      document.body.appendChild(container);
    }

    container.innerHTML = "";
    container.style.display = "block";

    const title = document.createElement("h4");
    title.innerText = type.toUpperCase();
    title.style.margin = "0 0 10px 0";
    container.appendChild(title);

    if (type === 'distortion') {
      const wrapper = document.createElement("div");
      wrapper.style.marginBottom = "10px";
      
      const label = document.createElement("span");
      label.innerText = "Drive: ";
      
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "400";
      slider.value = this.effectParams.amount;

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

    // Action Buttons
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "10px";

    const freezeBtn = document.createElement("button");
    freezeBtn.innerText = "APPLY (Freeze)";
    Object.assign(freezeBtn.style, { background: "green", color: "white", border: "none", padding: "5px 10px", cursor: "pointer" });
    freezeBtn.onclick = () => this.freezeCurrentEffect();

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "Cancel";
    Object.assign(cancelBtn.style, { background: "#555", color: "white", border: "none", padding: "5px 10px", cursor: "pointer" });
    cancelBtn.onclick = () => this.closeEffectPanel();

    btnContainer.appendChild(freezeBtn);
    btnContainer.appendChild(cancelBtn);
    container.appendChild(btnContainer);
  }

  /**
   * Renders the current real-time effect permanently into the audio buffer
   * and reloads the player.
   */
  async freezeCurrentEffect() {
    if (!this.previewEffectNode || !this.activeRegion) return;
    try {
      const newBuffer = await processRange(
        this.originalBuffer,
        this.audioContext,
        this.currentEffectType,
        this.activeRegion.start,
        this.activeRegion.end,
        this.effectParams
      );
      this.closeEffectPanel();
      if (newBuffer) await this.reloadWithBuffer(newBuffer);
    } catch (e) {
      console.error("Freeze Error:", e);
    }
  }

  /**
   * Closes the effect control panel and cleans up preview audio nodes.
   */
  closeEffectPanel() {
    const container = document.getElementById("effect-controls-container");
    if (container) container.style.display = "none";

    this.previewEffectNode = null;
    this.activeRegion = null;
    this.currentEffectType = null;
    
    // Reset routing
    this.eqInitialized = false;
    this.initEqualizer();
  }

  // ===========================================================================
  // TRIM & EDITING TOOLS
  // ===========================================================================

  /**
   * Initializes the left/right "curtains" (regions) used for trimming audio.
   */
  initTrimCurtains() {
    const duration = this.wavesurfer.getDuration();
    const shadowColor = "rgba(0, 0, 0, 0.65)";
    const handleColor = "var(--color-red)";

    // Clean old curtains
    this.regions.getRegions().forEach(r => {
      if (r.id === "left-curtain" || r.id === "right-curtain") r.remove();
    });

    this.leftCurtain = this.regions.addRegion({
      id: "left-curtain", start: 0, end: 0, color: shadowColor,
      drag: false, resize: true, loop: false,
      handleStyle: {
        left: { display: "none" },
        right: { backgroundColor: handleColor, width: "4px", opacity: "1", zIndex: "10" }
      }
    });

    this.rightCurtain = this.regions.addRegion({
      id: "right-curtain", start: duration, end: duration, color: shadowColor,
      drag: false, resize: true, loop: false,
      handleStyle: {
        left: { backgroundColor: handleColor, width: "4px", opacity: "1", zIndex: "10" },
        right: { display: "none" }
      }
    });
  }

  /**
   * Creates the DOM elements for the custom Trim UI (handles and overlays).
   */
  createTrimUI() {
    const container = document.getElementById("waveform");
    container.querySelectorAll('.trim-ui-element').forEach(el => el.remove());

    this.trimUI = { container };

    // Create UI Elements
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

    // Append
    container.append(this.trimUI.leftOverlay, this.trimUI.rightOverlay, this.trimUI.leftHandle, this.trimUI.rightHandle);

    // Enable Drag
    this.enableDrag(this.trimUI.leftHandle, 'left');
    this.enableDrag(this.trimUI.rightHandle, 'right');
  }

  /**
   * Adds drag logic to Trim UI handles.
   * @param {HTMLElement} element - The handle to drag.
   * @param {string} type - 'left' or 'right'.
   */
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

  /**
   * Slices the main buffer based on Trim UI handle positions and reloads.
   */
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

    if (startRatio >= endRatio || (startRatio === 0 && endRatio === 1)) return;

    const startFrame = Math.floor(startRatio * this.originalBuffer.length);
    const endFrame = Math.floor(endRatio * this.originalBuffer.length);
    
    if (endFrame - startFrame <= 0) return;

    const trimmedBuffer = sliceBuffer(
      this.originalBuffer,
      startRatio,
      endRatio,
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

  /**
   * Configures the BeatDetect instance for Tap Tempo logic.
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

  /**
   * Analyses the current audio buffer to automatically detect BPM.
   */
  async detectBPM() {
    this.beatDetect.getBeatInfo({ url: this.currentAudioURL })
      .then((info) => {
        this.bpm = Math.round(info.bpm);
        document.getElementById("bpm-led").textContent = this.bpm + " BPM";
      })
      .catch((error) => { /* Handle error silently */ });
  }

  /**
   * Adds the Magnet button and Quantization dropdown to the BPM UI.
   */
  initMagnetUI() {
    const bpmWrapper = document.querySelector(".bpm-led-wrapper");
    if (!bpmWrapper) return;

    const magnetContainer = document.createElement("div");
    magnetContainer.style.cssText = "display:flex; align-items:center; gap:5px; margin-top:10px; justify-content:center;";

    // Magnet Button
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

    // Quantize Select
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

  /**
   * Aligns region boundaries to the nearest grid line based on BPM and Quantization.
   * @param {Object} region - The region to snap.
   */
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

  /**
   * Enables double-click on BPM LED to manually enter BPM value.
   */
  setupBpmInput() {
    const bpmLed = document.getElementById("bpm-led");
    if (!bpmLed) return;

    bpmLed.addEventListener("dblclick", () => {
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

  /**
   * Attaches event listeners to global UI buttons (Play, Pause, Stop, etc.)
   * and keyboard shortcuts.
   */
  setupEventListeners() {
    // Playback Controls
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

    // Zoom / Region Modifiers
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

    // Shortcuts
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

    // Drag and Drop Logic
    this.setupGlobalDragDrop();
    this.setupBpmInput();
  }

  /**
   * Sets up global Drag and Drop for loading audio files into the waveform.
   */
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
      if (effectType) return; // Logic handled in Region Drop

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

  /**
   * Saves the current audio state to history for undo functionality.
   * @param {string} url - The current Blob URL.
   */
  addToHistory(url) {
    this.history.push(url);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack = [];
  }

  /**
   * Reverts to the previous audio state.
   */
  undo() {
    if (this.history.length === 0) return;
    this.redoStack.push(this.currentAudioURL);
    const previousUrl = this.history.pop();
    this.wavesurfer.load(previousUrl);
    this.currentAudioURL = previousUrl;
    this.regions.clearRegions();
  }

  /**
   * Reapplies the previously undone audio state.
   */
  redo() {
    if (this.redoStack.length === 0) return;
    this.history.push(this.currentAudioURL);
    const nextUrl = this.redoStack.pop();
    this.wavesurfer.load(nextUrl);
    this.currentAudioURL = nextUrl;
  }
}