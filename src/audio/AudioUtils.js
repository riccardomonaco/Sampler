/**
 * AudioUtils.js
 * Functions for AudioBuffer manipulation, WAV conversion, and audio effects.
 */

export const soundBanks = {
  "90's Jungle": [
    {
      name: "Glassy",
      url: "./assets/audio/90sjungle/glass.wav",
      color: "var(--color-red)",
    },
    {
      name: "Technique",
      url: "./assets/audio/90sjungle/tech.wav",
      color: "var(--color-ambra)",
    },
    {
      name: "Percs",
      url: "./assets/audio/90sjungle/perc.wav",
      color: "var(--color-green)",
    },
    {
      name: "Classic",
      url: "./assets/audio/90sjungle/classic.wav",
      color: "var(--color-blu)",
    }
  ],
};

export const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// ===========================================================================
// WAV CONVERSION (Little Endian / Correct Headers)
// ===========================================================================

/**
 * Converts an AudioBuffer into a WAV Blob.
 * Handles header writing and PCM 16-bit encoding.
 * @param {AudioBuffer} abuffer - The source buffer.
 * @param {number} len - Optional custom length.
 * @returns {Blob} The WAV file blob.
 */
export function bufferToWave(abuffer, len) {
  const numOfChan = abuffer.numberOfChannels;
  const length = len || abuffer.length;
  const lengthInBytes = length * numOfChan * 2;
  const buffer = new ArrayBuffer(44 + lengthInBytes);
  const view = new DataView(buffer);
  
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + lengthInBytes, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, abuffer.sampleRate, true);
  view.setUint32(28, abuffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, lengthInBytes, true);

  const dataView = new Int16Array(buffer, 44, length * numOfChan);
  
  // Channel optimization
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

  let offset = 0;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = channels[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      dataView[offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ===========================================================================
// DIRECT MATH EFFECTS (Synchronous)
// ===========================================================================

/**
 * Reverses a specific range of audio within a buffer.
 * @param {AudioBuffer} buffer - The original buffer.
 * @param {number} startTime - Start time in seconds.
 * @param {number} endTime - End time in seconds.
 * @param {AudioContext} context - The audio context to create the new buffer.
 * @returns {AudioBuffer} The new buffer with the reversed section.
 */
export function reverseRange(buffer, startTime, endTime, context) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const newBuffer = context.createBuffer(numChannels, buffer.length, sampleRate);
  
  const startFrame = Math.floor(startTime * sampleRate);
  const endFrame = Math.floor(endTime * sampleRate);

  for (let i = 0; i < numChannels; i++) {
    const originalData = buffer.getChannelData(i);
    const newData = newBuffer.getChannelData(i);
    newData.set(originalData); // Copy all

    // Reverse only the range
    if (endFrame > startFrame) {
        const segment = newData.subarray(startFrame, endFrame);
        segment.reverse();
    }
  }
  return newBuffer;
}

// ===========================================================================
// EFFECT HELPERS
// ===========================================================================

/**
 * Generates a distortion curve for the WaveShaperNode.
 * @param {number} amount - The amount of distortion (0-400+).
 * @returns {Float32Array} The calculated curve.
 */
export function makeDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// ===========================================================================
// OFFLINE EFFECTS (Freeze / Apply)
// ===========================================================================

/**
 * Renders an effect (Distortion, etc.) offline onto a specific region.
 * Uses OfflineAudioContext to process faster than real-time.
 * @param {AudioBuffer} originalBuffer - The source buffer.
 * @param {number} regionStart - Start time in seconds.
 * @param {number} regionEnd - End time in seconds.
 * @param {string} effectType - Name of the effect ('distortion', etc.).
 * @param {Object} params - Parameters for the effect (e.g., amount).
 * @returns {Promise<AudioBuffer>} The final processed buffer.
 */
export async function renderOfflineEffect(originalBuffer, regionStart, regionEnd, effectType, params) {
    const sampleRate = originalBuffer.sampleRate;
    const channels = originalBuffer.numberOfChannels;
    
    // Calculate exact frames
    const startFrame = Math.floor(regionStart * sampleRate);
    const endFrame = Math.floor(regionEnd * sampleRate);
    const lengthFrame = endFrame - startFrame;

    if (lengthFrame <= 0) return originalBuffer;

    // 1. Setup Reduced Context (Clip only)
    const clipCtx = new OfflineAudioContext(channels, lengthFrame, sampleRate);
    const clipSource = clipCtx.createBufferSource();
    
    // 2. Extract Original Clip
    const tempBuffer = clipCtx.createBuffer(channels, lengthFrame, sampleRate);
    for(let c=0; c<channels; c++) {
        tempBuffer.copyToChannel(originalBuffer.getChannelData(c).slice(startFrame, endFrame), c);
    }
    clipSource.buffer = tempBuffer;

    // 3. Apply Effect
    let effectNode = null;
    if (effectType === 'distortion') {
        effectNode = clipCtx.createWaveShaper();
        effectNode.curve = makeDistortionCurve(params.amount);
        effectNode.oversample = '4x';
    }

    // 4. Connect and Render
    if (effectNode) {
        clipSource.connect(effectNode);
        effectNode.connect(clipCtx.destination);
    } else {
        clipSource.connect(clipCtx.destination);
    }
    
    clipSource.start(0);
    const processedClip = await clipCtx.startRendering();

    // 5. Paste into Original Buffer (Freeze)
    const finalBuffer = new OfflineAudioContext(channels, originalBuffer.length, sampleRate).createBuffer(channels, originalBuffer.length, sampleRate);
    
    for(let c=0; c<channels; c++) {
        const data = finalBuffer.getChannelData(c);
        data.set(originalBuffer.getChannelData(c)); // Copy old
        data.set(processedClip.getChannelData(c), startFrame); // Overwrite processed
    }

    return finalBuffer;
}

// ===========================================================================
// MAIN EFFECT ROUTER
// ===========================================================================

/**
 * Routes processing requests to either synchronous or asynchronous handlers.
 * @param {AudioBuffer} buffer - Source buffer.
 * @param {AudioContext} context - Audio context.
 * @param {string} type - Effect type.
 * @param {number} startTime - Region start.
 * @param {number} endTime - Region end.
 * @param {Object} params - Effect parameters.
 * @returns {Promise<AudioBuffer>|AudioBuffer} The processed buffer.
 */
export async function processRange(buffer, context, type, startTime, endTime, params = {}) {
  // Synchronous Effects
  if (type === 'reverse') {
    return reverseRange(buffer, startTime, endTime, context);
  }
  
  // Asynchronous Effects (Offline Rendering)
  if (type === 'distortion' || type === 'delay' || type === 'reverb') {
      return await renderOfflineEffect(buffer, startTime, endTime, type, params);
  }

  return buffer;
}

// ===========================================================================
// BUFFER SLICING
// ===========================================================================

/**
 * Creates a new buffer from a slice of the original buffer (Trim).
 * @param {AudioBuffer} buffer - Source buffer.
 * @param {number} startRatio - Start position (0-1).
 * @param {number} endRatio - End position (0-1).
 * @param {AudioContext} context - Audio context.
 * @returns {AudioBuffer|null} The sliced buffer or null if invalid.
 */
export function sliceBuffer(buffer, startRatio, endRatio, context) {
    const startFrame = Math.floor(startRatio * buffer.length);
    const endFrame = Math.floor(endRatio * buffer.length);
    const frameCount = endFrame - startFrame;
  
    if (frameCount <= 0) return null;
  
    const newBuffer = context.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate);
  
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      newBuffer.copyToChannel(buffer.getChannelData(i).slice(startFrame, endFrame), i);
    }
  
    return newBuffer;
}