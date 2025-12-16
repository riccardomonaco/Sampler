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

export function bufferToWave(abuffer, len) {
  const numOfChan = abuffer.numberOfChannels;
  const length = len * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i, sample, offset = 0, pos = 0;

  // Helpers per scrivere i byte
  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

  // --- HEADER WAV ---
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16);         // length = 16
  setUint16(1);          // PCM (Standard non compresso)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // byte rate
  setUint16(numOfChan * 2); // block-align
  setUint16(16);         // 16-bit

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // --- SCRITTURA DATI ---
  for (i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  offset = 44;
  for (let j = 0; j < len; j++) {
    for (i = 0; i < numOfChan; i++) {
      // Clamping: Assicura che il volume non spacchi le casse (>1 o <-1)
      sample = Math.max(-1, Math.min(1, channels[i][j]));
      
      // Conversione a 16-bit: (0x7FFF = 32767)
      // Usiamo un operatore ternario per la massima precisione sui negativi
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
      
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}