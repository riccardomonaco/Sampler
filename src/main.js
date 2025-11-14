/*********************************
 * IMPORTS
 *********************************/

import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "../node_modules/wavesurfer.js/dist/plugins/regions.esm.js";
import { createPageDefault } from "./ui/ui.js";

/*********************************
 * MODEL
 *********************************/

export const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const audioContext = new AudioContext();
var sampleRate = audioContext.sampleRate;

let wavesurfer;

let regions = RegionsPlugin.create();
let loopRegion = null;
let looping = false;
let loopDurationSeconds = 2;

const isPlaying = false;

/*********************************
 * VIEW
 *********************************/

/*********************************
 * CONTROLLER
 *********************************/
function initSampler() {
  createPageDefault();
  initWaveSurfer();
  initCommandsButtons();
}

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
    plugin: [regions],
  });

  wavesurfer.load("../assets/audio/audio.mp3");

  wavesurfer.on("interaction", () => {
    wavesurfer.playPause();
  });

/*
  wavesurfer.once("play", () => {
     const filters = eqBands.map((band) => {
      const filter = audioContext.createBiquadFilter();
      filter.type =
        band <= 32
          ? "lowavesurferhelf"
          : band >= 16000
          ? "highshelf"
          : "peaking";
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

  wavesurfer.on("decode", () => {
    let loop = true;

    {
      let activeRegion = null;
      regions.on("region-in", (region) => {
        console.log("region-in", region);
        activeRegion = region;
      });
      regions.on("region-out", (region) => {
        console.log("region-out", region);
        if (activeRegion === region) {
          if (loop) {
            region.play();
          } else {
            activeRegion = null;
          }
        }
      });
      regions.on("region-clicked", (region, e) => {
        e.stopPropagation(); // prevent triggering a click on the waveform
        activeRegion = region;
        region.play(true);
        region.setOptions({ color: randomColor() });
      });
      // Reset the active region when the user clicks anywhere in the waveform
      wavesurfer.on("interaction", () => {
        activeRegion = null;
      });
    }
  }); */
}

/**
 *
 *
 */
function initCommandsButtons() {
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

document.addEventListener("DOMContentLoaded", initSampler());
