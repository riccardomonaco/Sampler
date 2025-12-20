import { eqBands, soundBanks } from "../audio/AudioUtils";

const bankSelect = document.getElementById("banks");
const banksContent = document.querySelector(".banks-content");

// ===========================================================================
// MAIN LAYOUT CREATORS
// ===========================================================================

/**
 * Constructs the main Sampler interface (Waveform + EQ + Transport).
 * @return {HTMLElement} The sampler wrapper element.
 */
function createSampler() {
  const samplerMain = document.createElement("div");
  samplerMain.classList.add("sampler-wrapper");

  const sampler = document.createElement("div");
  sampler.classList.add("sampler");
  sampler.classList.add("border-shadow");
  sampler.appendChild(createWaveWrapper());
  sampler.appendChild(createEqualizerGrid().appendChild(createEqualizer()));

  const commands = document.createElement("div");
  commands.classList.add("commands");
  commands.classList.add("border-shadow");
  commands.appendChild(createCommandsButtons());

  samplerMain.appendChild(sampler);
  samplerMain.appendChild(commands);
  return samplerMain;
}

/**
 * Constructs the Effects sidebar (Loop controls + Effect slots).
 * @return {HTMLElement} The effects wrapper element.
 */
function createEffects() {
  // MAIN SIDE WRAPPER
  const effects = document.createElement("div");
  effects.classList.add("effects");
  effects.classList.add("border-shadow");

  // LOOP CONTROL WRAPPER
  const loopButtons = document.createElement("div");
  loopButtons.classList.add("loop-buttons");

  const d2Buttons = document.createElement("div");
  d2Buttons.classList.add("old-button");
  d2Buttons.textContent = "◀";
  d2Buttons.setAttribute("id", "d2-button");

  const loopButton = document.createElement("div");
  loopButton.classList.add("old-button");
  loopButton.textContent = "↻";
  loopButton.setAttribute("id", "loop-button");

  const x2Button = document.createElement("div");
  x2Button.classList.add("old-button");
  x2Button.textContent = "▶";
  x2Button.setAttribute("id", "x2-button");

  loopButtons.appendChild(d2Buttons);
  loopButtons.appendChild(loopButton);
  loopButtons.appendChild(x2Button);

  const loopLabel = document.createElement("div");
  loopLabel.classList.add("loop-label");
  loopLabel.textContent = "LOOP CONTROLS";

  effects.appendChild(loopButtons);
  effects.appendChild(loopLabel);

  return effects;
}

/**
 * Creates the standard transport buttons (Play, Pause, Stop).
 * @return {HTMLElement} The container with buttons.
 */
function createCommandsButtons() {
  const commandButtons = document.createElement("div");
  commandButtons.classList.add("command-buttons");

  const playButton = document.createElement("div");
  playButton.classList.add("old-button");
  playButton.textContent = "▶︎";
  playButton.setAttribute("id", "play-button");

  const pauseButton = document.createElement("div");
  pauseButton.classList.add("old-button");
  pauseButton.textContent = "||";
  pauseButton.setAttribute("id", "pause-button");

  const stopButton = document.createElement("div");
  stopButton.classList.add("old-button");
  stopButton.textContent = "◼";
  stopButton.setAttribute("id", "stop-button");

  commandButtons.appendChild(playButton);
  commandButtons.appendChild(pauseButton);
  commandButtons.appendChild(stopButton);

  return commandButtons;
}

/**
 * Creates the empty container for WaveSurfer.
 * @return {HTMLElement} The waveform container.
 */
function createWaveWrapper() {
  const waveContainer = document.createElement("div");
  waveContainer.setAttribute("id", "waveform");
  return waveContainer;
}

/**
 * Assembles the complete page layout structure and appends to root.
 */
export function createPageDefault() {
  const wrapper = document.createElement("div");
  wrapper.classList.add("wrapper");

  wrapper.appendChild(createSampler());
  wrapper.appendChild(createEffects());

  // Assuming 'root' is defined globally or imported elsewhere in your app structure
  // If strict, pass 'root' as an argument.
  root.appendChild(wrapper); 
}

// ===========================================================================
// EQUALIZER GENERATOR
// ===========================================================================

/**
 * Generates EQ sliders based on the imported `eqBands` configuration.
 * @return {HTMLElement} The populated sliders wrapper.
 */
export default function createEqualizer() {
  const slidersContainer = document.getElementById("sliders-wrapper");
  
  eqBands.map((e) => {
    const eqBand = document.createElement("div");
    eqBand.classList.add("eq-band");

    const slider = document.createElement("input");
    slider.classList.add("slider-eq");
    slider.type = "range";
    slider.min = -12;
    slider.max = 12;
    slider.value = 0;
    slider.step = 0.1;
    
    // Reset on double click
    slider.addEventListener("dblclick", (event) => {
      slider.value = 0;
      slider.dispatchEvent(new Event("input"));
    });

    const eqLabel = document.createElement("div");
    eqBand.classList.add("eq-label");
    eqLabel.textContent = formatFreqLabel(e);

    eqBand.appendChild(slider);
    eqBand.appendChild(eqLabel);
    slidersContainer.appendChild(eqBand);
  });
  return slidersContainer;
}

/**
 * Creates the grid container for the EQ sliders.
 * @return {HTMLElement} The grid element.
 */
function createEqualizerGrid() {
  const slidersGrid = document.createElement("div");
  slidersGrid.classList.add("eq-grid");
  return slidersGrid;
}

/**
 * Helper to format frequency numbers into Hz/kHz strings.
 * @param {number} freq - Frequency in Hz.
 * @returns {string} Formatted label.
 */
function formatFreqLabel(freq) {
  if (freq >= 1000) {
    return `${freq / 1000}kHz`;
  }
  return `${freq} Hz`;
}

// ===========================================================================
// BANK & SAMPLE MANAGEMENT
// ===========================================================================

/**
 * Generates sample pads for a selected bank name.
 * @param {string} bankName - The key name of the bank in soundBanks.
 */
function createBank(bankName) {
  banksContent.innerHTML = "";

  if (!bankName) return;

  const samples = soundBanks[bankName];
  if (!samples) return;

  samples.forEach((sample) => {
    const pad = document.createElement("div");
    pad.classList.add("sample-pad");
    pad.textContent = sample.name;
    pad.style.borderBottom = `4px solid ${sample.color}`;

    pad.draggable = true;
    pad.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("type", "sample");
      e.dataTransfer.setData("audioUrl", sample.url);
      e.dataTransfer.effectAllowed = "copy";
    });

    banksContent.appendChild(pad);
  });
}

/**
 * Initializes the dropdown menu with available sound banks.
 */
export function initBankMenu() {
  bankSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = ""; 
  defaultOption.textContent = "-- SELECT SOUND BANK --";
  defaultOption.disabled = true; 
  defaultOption.selected = true;
  defaultOption.hidden = true; 
  bankSelect.appendChild(defaultOption);

  Object.keys(soundBanks).forEach((bankName) => {
    const option = document.createElement("option");
    option.value = bankName;
    option.textContent = bankName;
    bankSelect.appendChild(option);
  });
}

// Event Listeners
bankSelect.addEventListener("change", (e) => {
  createBank(e.target.value);
});

// Deprecated / Placeholder
export function createAddSample() {
  // Assuming 'plus' is defined elsewhere or this is a WIP
  // plus = document.createElement("div");
  // plus.classList.add("");
}