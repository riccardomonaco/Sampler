/*********************************
 * MODEL
 *********************************/

const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const audioContext = new AudioContext();
var sampleRate = audioContext.sampleRate;

let wavesurfer;

let regions = null;
let loopRegion = null;
let looping = false;
let loopDurationSeconds = 2;

const isPlaying = false;

const filters = eqBands.map((band) => {
  const filter = audioContext.createBiquadFilter();
  filter.type =
    band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
  filter.gain.value = Math.random() * 40 - 20;
  filter.Q.value = 1; // resonance
  filter.frequency.value = band; // the cut-off frequency
  return filter;
});

/*********************************
 * VIEW
 *********************************/

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
  waveContainer = document.createElement("div");
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
  slidersContainer = document.createElement("div");
  slidersContainer.classList.add("sliders-wrapper");
  const sliders = eqBands.map((e) => {
    const slider = document.createElement("input");
    slider.classList.add("slider-eq");
    slider.type = "range";
    slider.min = -40;
    slider.max = 40;
    slider.value = 0;
    slider.step = 0.1;
    slider.label = "ciao";
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
  slidersGrid = document.createElement("div");
  slidersGrid.classList.add("eq-grid");
  return slidersGrid;
}

function createPage() {
  const wrapper = document.createElement("div");
  wrapper.classList.add("wrapper");

  wrapper.appendChild(createSampler());
  wrapper.appendChild(createEffects());

  root.appendChild(wrapper);

  initWaveSurfer();
  initCommandsButtons();
}

/*********************************
 * CONTROLLER
 *********************************/

/**
 *
 *
 */
function initWaveSurfer() {
  wavesurfer = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#ccc",
    progressColor: "#2196f3",
    cursorColor: "#333",
    height: 250,
  });

  wavesurfer.load("audio/audio.mp3");

  wavesurfer.on("interaction", () => {
    wavesurfer.playPause();
  });

  wavesurfer.once("play", () => {
    // Create Web Audio context
    const audioContext = new AudioContext();

    // Create a biquad filter for each band
    const filters = eqBands.map((band) => {
      const filter = audioContext.createBiquadFilter();
      filter.type =
        band <= 32 ? "lowshelf" : band >= 16000 ? "highshelf" : "peaking";
      filter.gain.value = Math.random() * 40 - 20;
      filter.Q.value = 1; // resonance
      filter.frequency.value = band; // the cut-off frequency
      return filter;
    });

    const audio = wavesurfer.getMediaElement();
    const mediaNode = audioContext.createMediaElementSource(audio);

    // Connect the filters and media node sequentially
    const equalizer = filters.reduce((prev, curr) => {
      prev.connect(curr);
      return curr;
    }, mediaNode);

    // Connect the filters to the audio output
    equalizer.connect(audioContext.destination);

    const sliders = document.querySelectorAll(".slider-eq");
    console.log(sliders);

    sliders.forEach((slider, i) => {
      const filter = filters[i];
      filter.gain.value = slider.value;
      slider.oninput = (e) => (filter.gain.value = e.target.value);
    });
  });

  regions = wavesurfer.registerPlugin(WaveSurfer.Regions.create());
}

/**
 *
 *
 */
function initCommandsButtons() {
  document
    .getElementById("play-button")
    .setAttribute("onclick", "wavesurfer.play()");

  document
    .getElementById("pause-button")
    .setAttribute("onclick", "wavesurfer.pause()");

  document
    .getElementById("stop-button")
    .setAttribute("onclick", "wavesurfer.stop()");

  document
    .getElementById("loop-button")
    .setAttribute("onclick", "loopController()");

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

/**
 *
 *
 */
function loopController() {
  if (!looping) {
    loopRegion = regions.addRegion({
      start: 0,
      end: loopDurationSeconds,
      color: "rgba(255,255,255,0.2)",
      loop: true,
    });
    looping = true;
  } else {
    regions.clearRegions();
    looping = false;
  }
}

document.addEventListener("DOMContentLoaded", createPage());
