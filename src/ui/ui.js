import { eqBands } from "../main.js";

/**
 *
 *
 * @return {*}
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
 *
 *
 * @return {*}
 */
function createEffects() {
  //MAIN SIDE WRAPPER
  const effects = document.createElement("div");
  effects.classList.add("effects");
  effects.classList.add("border-shadow");

  //LOOP CONTROL WRAPPER
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

  //EFFECTS WRAPPER

  effects.appendChild(loopButtons);
  effects.appendChild(loopLabel);

  return effects;
}

/**
 *
 *
 * @return {*}
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
 *
 *
 * @return {*}
 */
function createWaveWrapper() {
  const waveContainer = document.createElement("div");
  waveContainer.setAttribute("id", "waveform");
  return waveContainer;
}

/**
 *
 *
 * @return {*}
 */
function createEqualizer() {
  const grid = createEqualizerGrid();
  const slidersContainer = document.createElement("div");
  slidersContainer.classList.add("sliders-wrapper");
  const sliders = eqBands.map((e) => {
    const slider = document.createElement("input");
    slider.classList.add("slider-eq");
    slider.type = "range";
    slider.min = -40;
    slider.max = 40;
    slider.value = 0;
    slider.step = 0.1;
    slider.addEventListener("dblclick", (event) => {
      slider.value = 0;
    });
    slidersContainer.appendChild(slider);
  });
  grid.appendChild(slidersContainer);
  return grid;
}

/**
 *
 *
 * @return {*}
 */
function createEqualizerGrid() {
  const slidersGrid = document.createElement("div");
  slidersGrid.classList.add("eq-grid");
  return slidersGrid;
}

/**
 *
 *
 */
export function createPageDefault() {
  const wrapper = document.createElement("div");
  wrapper.classList.add("wrapper");

  wrapper.appendChild(createSampler());
  wrapper.appendChild(createEffects());

  root.appendChild(wrapper);
}
