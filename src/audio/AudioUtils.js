/**
 * AudioUtils.js
 * Funzioni per la manipolazione di AudioBuffer e file WAV.
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

/* --- CONVERSIONE WAV (Little Endian / Header Corretto) --- */
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
  // Ottimizzazione canali
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

/* --- EFFETTI MATEMATICI (Processamento Diretto) --- */

export function reverseRange(buffer, startTime, endTime, context) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const newBuffer = context.createBuffer(numChannels, buffer.length, sampleRate);
  
  const startFrame = Math.floor(startTime * sampleRate);
  const endFrame = Math.floor(endTime * sampleRate);

  for (let i = 0; i < numChannels; i++) {
    const originalData = buffer.getChannelData(i);
    const newData = newBuffer.getChannelData(i);
    newData.set(originalData); // Copia tutto

    // Inverti solo il range
    if (endFrame > startFrame) {
        const segment = newData.subarray(startFrame, endFrame);
        segment.reverse();
    }
  }
  return newBuffer;
}

/* --- HELPER DISTORSIONE --- */
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

/* --- EFFETTI OFFLINE (Freeze / Apply) --- */
export async function renderOfflineEffect(originalBuffer, regionStart, regionEnd, effectType, params) {
    const sampleRate = originalBuffer.sampleRate;
    const channels = originalBuffer.numberOfChannels;
    
    // Tagliamo i tempi esatti
    const startFrame = Math.floor(regionStart * sampleRate);
    const endFrame = Math.floor(regionEnd * sampleRate);
    const lengthFrame = endFrame - startFrame;

    if (lengthFrame <= 0) return originalBuffer;

    // 1. Setup Contesto Ridotto (solo per la clip)
    const clipCtx = new OfflineAudioContext(channels, lengthFrame, sampleRate);
    const clipSource = clipCtx.createBufferSource();
    
    // 2. Estrai Clip Originale
    const tempBuffer = clipCtx.createBuffer(channels, lengthFrame, sampleRate);
    for(let c=0; c<channels; c++) {
        tempBuffer.copyToChannel(originalBuffer.getChannelData(c).slice(startFrame, endFrame), c);
    }
    clipSource.buffer = tempBuffer;

    // 3. Applica Effetto
    let effectNode = null;
    if (effectType === 'distortion') {
        effectNode = clipCtx.createWaveShaper();
        effectNode.curve = makeDistortionCurve(params.amount);
        effectNode.oversample = '4x';
    }

    // 4. Collega e Renderizza
    if (effectNode) {
        clipSource.connect(effectNode);
        effectNode.connect(clipCtx.destination);
    } else {
        clipSource.connect(clipCtx.destination);
    }
    
    clipSource.start(0);
    const processedClip = await clipCtx.startRendering();

    // 5. Incolla nel buffer originale (Freeze)
    const finalBuffer = new OfflineAudioContext(channels, originalBuffer.length, sampleRate).createBuffer(channels, originalBuffer.length, sampleRate);
    
    for(let c=0; c<channels; c++) {
        const data = finalBuffer.getChannelData(c);
        data.set(originalBuffer.getChannelData(c)); // Copia vecchio
        data.set(processedClip.getChannelData(c), startFrame); // Sovrascrivi processato
    }

    return finalBuffer;
}

/* --- ROUTER EFFETTI (Smistamento) --- */
export async function processRange(buffer, context, type, startTime, endTime, params = {}) {
  // Effetti sincroni
  if (type === 'reverse') {
    return reverseRange(buffer, startTime, endTime, context);
  }
  
  // Effetti asincroni (Offline Rendering)
  if (type === 'distortion' || type === 'delay' || type === 'reverb') {
      return await renderOfflineEffect(buffer, startTime, endTime, type, params);
  }

  return buffer;
}

/* --- SLICE UTILS --- */
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