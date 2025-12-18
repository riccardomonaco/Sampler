/**
 * AudioUtils.js
 * Funzioni per la manipolazione di AudioBuffer e file WAV.
 */

export const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

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

/**
 * Inverte un AudioBuffer (Reverse effect)
 * @param {AudioBuffer} buffer - Il buffer originale
 * @param {AudioContext} context - Il contesto audio necessario per creare il nuovo buffer
 * @returns {AudioBuffer} - Il nuovo buffer invertito
 */
export function reverseBuffer(buffer, context) {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    const newBuffer = context.createBuffer(numberOfChannels, length, sampleRate);

    for (let i = 0; i < numberOfChannels; i++) {
        const channelData = buffer.getChannelData(i);
        // .slice() crea una copia, .reverse() inverte
        const reversedData = channelData.slice().reverse();
        newBuffer.copyToChannel(reversedData, i);
    }

    return newBuffer;
}

/**
 * Taglia un buffer (Slice) mantenendo il sample rate originale
 * @param {AudioBuffer} buffer - Buffer originale
 * @param {number} startRatio - Punto di inizio (0.0 - 1.0)
 * @param {number} endRatio - Punto di fine (0.0 - 1.0)
 * @param {AudioContext} context - Contesto audio
 * @returns {AudioBuffer|null} - Buffer tagliato o null se invalido
 */
export function sliceBuffer(buffer, startRatio, endRatio, context) {
    const startFrame = Math.floor(startRatio * buffer.length);
    const endFrame = Math.floor(endRatio * buffer.length);
    const frameCount = endFrame - startFrame;

    if (frameCount <= 0) return null;

    const newBuffer = context.createBuffer(
        buffer.numberOfChannels,
        frameCount,
        buffer.sampleRate
    );

    for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channelData = buffer.getChannelData(i);
        newBuffer.copyToChannel(channelData.slice(startFrame, endFrame), i);
    }

    return newBuffer;
}

/**
 * Converte AudioBuffer in Blob WAV (Lossless, 16-bit PCM, Little Endian)
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

    // Header WAV
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

    // Dati PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numOfChan; ch++) {
            let sample = abuffer.getChannelData(ch)[i];
            sample = Math.max(-1, Math.min(1, sample));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
    }

    return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Applica il reverse solo in una specifica finestra temporale.
 * @param {AudioBuffer} buffer - Buffer originale
 * @param {number} startTime - Inizio effetto (secondi)
 * @param {number} endTime - Fine effetto (secondi)
 * @param {AudioContext} context - Contesto audio
 * @returns {AudioBuffer} - Nuovo buffer con la sezione invertita
 */
export function reverseRange(buffer, startTime, endTime, context) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;

    // 1. Clona il buffer originale (per non modificare quello attuale in-place)
    // Questo è fondamentale se in futuro vorrai fare "Undo"
    const newBuffer = context.createBuffer(numChannels, buffer.length, sampleRate);

    // Calcola i frame (indici dell'array) basati sul tempo
    const startFrame = Math.floor(startTime * sampleRate);
    const endFrame = Math.floor(endTime * sampleRate);
    const frameLength = endFrame - startFrame;

    // Se la selezione è invalida o troppo piccola, ritorna una copia identica
    if (frameLength <= 0) {
        for (let i = 0; i < numChannels; i++) {
            newBuffer.copyToChannel(buffer.getChannelData(i), i);
        }
        return newBuffer;
    }

    // 2. Processa ogni canale
    for (let i = 0; i < numChannels; i++) {
        const originalData = buffer.getChannelData(i);
        const newData = newBuffer.getChannelData(i);

        // A. Copia tutto il buffer originale nel nuovo
        newData.set(originalData);

        // B. Isola la sezione da invertire
        // .subarray crea una "vista" modificabile di quella porzione di memoria
        const segment = newData.subarray(startFrame, endFrame);

        // C. Inverti la sezione (questo modifica newData in quel punto specifico)
        segment.reverse();
    }

    return newBuffer;
}