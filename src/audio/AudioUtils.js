/**
 * AudioUtils.js
 * Utility functions for AudioBuffer manipulation, WAV conversion,
 * and mathematical audio effect processing (Offline/Online helpers).
 */

import { db, storage, auth } from "../../src/firebase"; //
import { doc, setDoc, getDoc, updateDoc, arrayUnion, collection, getDocs, arrayRemove } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// 1. soundBanks diventa un contenitore che riempiremo all'avvio
export let soundBanks = {};

export const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// ===========================================================================
// WAV CONVERSION
// ===========================================================================

/**
 * Converts an AudioBuffer to a WAV formatted Blob.
 * Handles PCM 16-bit encoding and header construction.
 * * @param {AudioBuffer} abuffer - The source audio buffer.
 * @param {number} [len] - Optional length to override buffer length.
 * @returns {Blob} The generated WAV file as a Blob.
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
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

  let offset = 0;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = channels[ch][i];
      // Clamp values
      sample = Math.max(-1, Math.min(1, sample));
      // Convert float to 16-bit PCM
      dataView[offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ===========================================================================
// MATH UTILS & HELPERS
// ===========================================================================

/**
 * Creates a distortion curve for the WaveShaperNode.
 * * @param {number} amount - The intensity of distortion (0 to 400+).
 * @returns {Float32Array} The computed curve array.
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

/**
 * Applies mathematical Bitcrushing (Bit Reduction + Downsampling) to an AudioBuffer.
 * This is performed synchronously on the array data.
 * * @param {AudioBuffer} buffer - The buffer to process.
 * @param {number} bits - Bit depth (1 to 16).
 * @param {number} normFreq - Normalized frequency factor (0.0 to 1.0) for downsampling.
 * @returns {AudioBuffer} The modified buffer.
 */
function applyMathBitcrush(buffer, bits, normFreq) {
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  const step = 1 / Math.pow(2, bits);
  const stepScale = 1 / step; // Optimization pre-calc

  // Downsampling interval (1 = no reduction, 10 = take 1 every 10 samples)
  const stepSize = Math.floor(1 / normFreq);

  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    let lastSample = 0;

    for (let i = 0; i < len; i++) {
      if (i % stepSize === 0) {
        let sample = data[i];
        // Bit Depth Quantization
        sample = Math.round(sample * stepScale) * step;
        lastSample = sample;
      }
      // Sample & Hold effect
      data[i] = lastSample;
    }
  }
  return buffer;
}

// ===========================================================================
// DIRECT EFFECTS (Synchronous)
// ===========================================================================

/**
 * Reverses the audio data within a specific time range.
 * * @param {AudioBuffer} buffer - The source buffer.
 * @param {number} startTime - Start time in seconds.
 * @param {number} endTime - End time in seconds.
 * @param {AudioContext} context - Context used to create new buffer.
 * @returns {AudioBuffer} New buffer with reversed range.
 */
export function reverseRange(buffer, startTime, endTime, context) {
  const numChannels = buffer.numberOfChannels;
  const newBuffer = context.createBuffer(numChannels, buffer.length, buffer.sampleRate);
  const startFrame = Math.floor(startTime * buffer.sampleRate);
  const endFrame = Math.floor(endTime * buffer.sampleRate);

  for (let i = 0; i < numChannels; i++) {
    const originalData = buffer.getChannelData(i);
    const newData = newBuffer.getChannelData(i);
    newData.set(originalData);

    if (endFrame > startFrame) {
      const segment = newData.subarray(startFrame, endFrame);
      segment.reverse();
    }
  }
  return newBuffer;
}

// ===========================================================================
// OFFLINE EFFECTS (Freeze / Async)
// ===========================================================================

/**
 * Renders complex effects (Delay, Distortion) using an OfflineAudioContext.
 * This effectively "prints" the effect onto the audio selection.
 * * @param {AudioBuffer} originalBuffer - Source buffer.
 * @param {number} regionStart - Selection start time.
 * @param {number} regionEnd - Selection end time.
 * @param {string} effectType - 'distortion' | 'delay' | 'bitcrush'.
 * @param {Object} params - Effect parameters (amount, time, feedback, bits, etc.).
 * @returns {Promise<AudioBuffer>} The final processed buffer.
 */
export async function renderOfflineEffect(originalBuffer, regionStart, regionEnd, effectType, params) {
  const sampleRate = originalBuffer.sampleRate;
  const channels = originalBuffer.numberOfChannels;

  // Calculate precise frames
  const startFrame = Math.floor(regionStart * sampleRate);
  const endFrame = Math.floor(regionEnd * sampleRate);
  const lengthFrame = endFrame - startFrame;

  if (lengthFrame <= 0) return originalBuffer;

  // 1. Setup Offline Context (Clip Length)
  const clipCtx = new OfflineAudioContext(channels, lengthFrame, sampleRate);
  const clipSource = clipCtx.createBufferSource();

  // 2. Extract specific clip from original buffer
  const tempBuffer = clipCtx.createBuffer(channels, lengthFrame, sampleRate);
  for (let c = 0; c < channels; c++) {
    tempBuffer.copyToChannel(originalBuffer.getChannelData(c).slice(startFrame, endFrame), c);
  }
  clipSource.buffer = tempBuffer;

  // 3. Create Effect Graph
  let inputNode = clipSource;
  let endNode = clipCtx.destination;

  // --- DISTORTION ---
  if (effectType === 'distortion') {
    const dist = clipCtx.createWaveShaper();
    dist.curve = makeDistortionCurve(params.amount);
    dist.oversample = '4x';
    inputNode.connect(dist);
    dist.connect(endNode);
  }
  // --- DELAY ---
  else if (effectType === 'delay') {
    const delay = clipCtx.createDelay();
    delay.delayTime.value = params.time || 0.3;

    const feedback = clipCtx.createGain();
    feedback.gain.value = params.feedback || 0.5;

    // Routing: 
    // 1. Dry Signal -> Output
    // 2. Dry -> Delay -> Output
    // 3. Delay -> Feedback -> Delay (Loop)
    inputNode.connect(endNode);
    inputNode.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(endNode);
  }
  // --- BITCRUSH ---
  else if (effectType === 'bitcrush') {
    // Pass-through: Bitcrush is handled via post-processing math 
    // to ensure pixel-perfect sample reduction not easily doable with standard nodes offline.
    inputNode.connect(endNode);
  }

  // 4. Render
  clipSource.start(0);
  let processedClip = await clipCtx.startRendering();

  // 5. Post-Processing (Bitcrush Math)
  if (effectType === 'bitcrush') {
    processedClip = applyMathBitcrush(processedClip, params.bits || 8, params.normFreq || 0.5);
  }

  // 6. Merge (Freeze) back into full buffer
  const finalBuffer = new OfflineAudioContext(channels, originalBuffer.length, sampleRate).createBuffer(channels, originalBuffer.length, sampleRate);

  for (let c = 0; c < channels; c++) {
    const data = finalBuffer.getChannelData(c);
    data.set(originalBuffer.getChannelData(c)); // Copy original
    data.set(processedClip.getChannelData(c), startFrame); // Overwrite selected range
  }

  return finalBuffer;
}

// ===========================================================================
// MAIN EFFECT ROUTER
// ===========================================================================

/**
 * Routes effect requests to the appropriate handler (Sync or Async).
 * * @param {AudioBuffer} buffer - Source buffer.
 * @param {AudioContext} context - Main audio context.
 * @param {string} type - Effect type key.
 * @param {number} startTime - Region start.
 * @param {number} endTime - Region end.
 * @param {Object} [params={}] - Parameters for the effect.
 * @returns {Promise<AudioBuffer>|AudioBuffer} The processed result.
 */
export async function processRange(buffer, context, type, startTime, endTime, params = {}) {
  // Synchronous Effects
  if (type === 'reverse') {
    return reverseRange(buffer, startTime, endTime, context);
  }

  // Asynchronous / Offline Effects
  if (['distortion', 'delay', 'bitcrush'].includes(type)) {
    return await renderOfflineEffect(buffer, startTime, endTime, type, params);
  }

  return buffer;
}

/**
 * Creates a new buffer slice (Trim).
 * * @param {AudioBuffer} buffer - Source buffer.
 * @param {number} startRatio - Start percentage (0-1).
 * @param {number} endRatio - End percentage (0-1).
 * @param {AudioContext} context - Audio context.
 * @returns {AudioBuffer|null} New sliced buffer.
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

// ===========================================================================
// CLOUD FUNCTIONS
// ===========================================================================

/**
 * 1. Scarica tutte le banche da Firestore all'avvio
 */
export async function loadBanksFromCloud() {
  try {
    const querySnapshot = await getDocs(collection(db, "soundBanks"));
    soundBanks = {}; // Reset

    querySnapshot.forEach((doc) => {
      soundBanks[doc.id] = doc.data().samples || [];
    });

    return soundBanks;
  } catch (e) {
    return {};
  }
}

/**
 * 2. Crea una nuova banca su Firestore
 */
export async function createNewBank(name) {
  if (soundBanks[name]) return false;

  // Aggiorna locale
  soundBanks[name] = [];

  // Aggiorna Cloud (Usa il nome come ID documento)
  try {
    await setDoc(doc(db, "soundBanks", name), {
      createdAt: new Date(),
      owner: auth.currentUser ? auth.currentUser.uid : "anon",
      samples: []
    });
    return true;
  } catch (e) {
    console.error("Errore creazione banca:", e);
    return false;
  }
}

/**
 * 3. Carica file su Storage -> Ottieni URL -> Salva su Firestore
 */
export async function addSampleToBank(bankName, sampleName, fileBlob) {
  if (!soundBanks[bankName]) return;

  const user = auth.currentUser;
  if (!user) throw new Error("Utente non loggato");

  const storageRef = ref(storage, `users/${user.uid}/${bankName}/${sampleName}_${Date.now()}.wav`);

  console.log("Uploading to Cloud...");
  const snapshot = await uploadBytes(storageRef, fileBlob);
  const downloadURL = await getDownloadURL(snapshot.ref);

  const colors = ["var(--color-red)", "var(--color-ambra)", "var(--color-green)", "var(--color-blu)"];
  const newSample = {
    name: sampleName,
    url: downloadURL, // URL PERMANENTE del cloud
    color: colors[Math.floor(Math.random() * colors.length)]
  };

  // C. Aggiorna Firestore (arrayUnion aggiunge all'array senza sovrascrivere tutto)
  const bankRef = doc(db, "soundBanks", bankName);
  await updateDoc(bankRef, {
    samples: arrayUnion(newSample)
  });

  // D. Aggiorna Locale
  soundBanks[bankName].push(newSample);

  return newSample;
}

export async function deleteSampleFromBank(bankName, sampleObject) {
  if (!soundBanks[bankName]) return;

  // 1. Elimina dal Database (Firestore)
  const bankRef = doc(db, "soundBanks", bankName);
  await updateDoc(bankRef, {
    samples: arrayRemove(sampleObject) // Rimuove esattamente quell'oggetto dall'array
  });

  // 2. Elimina il file fisico (Storage)
  // Creiamo un riferimento partendo dall'URL completo
  try {
    const fileRef = ref(storage, sampleObject.url);
    await deleteObject(fileRef);
    console.log("File audio eliminato dallo storage.");
  } catch (error) {
    console.warn("Impossibile eliminare file dallo storage (forse già assente):", error);
  }

  // 3. Aggiorna Locale (per aggiornare la UI subito)
  // Filtriamo via il sample che ha lo stesso nome
  soundBanks[bankName] = soundBanks[bankName].filter(s => s.name !== sampleObject.name);
}