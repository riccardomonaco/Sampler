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
  const length = len || abuffer.length;
  const lengthInBytes = length * numOfChan * 2;
  const buffer = new ArrayBuffer(44 + lengthInBytes);
  const view = new DataView(buffer);

  // Helper scrittura stringhe
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // --- 1. SCRITTURA HEADER WAV STANDARD ---
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + lengthInBytes, true); // File size
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                // Chunk size
  view.setUint16(20, 1, true);                 // Format (1 = PCM)
  view.setUint16(22, numOfChan, true);         // Channels
  view.setUint32(24, abuffer.sampleRate, true);// Sample Rate
  view.setUint32(28, abuffer.sampleRate * 2 * numOfChan, true); // Byte Rate
  view.setUint16(32, numOfChan * 2, true);     // Block Align
  view.setUint16(34, 16, true);                // Bits per Sample
  writeString(view, 36, 'data');
  view.setUint32(40, lengthInBytes, true);     // Data size

  // --- 2. SCRITTURA DATI (PCM 16-bit) ---
  // Scriviamo i campioni usando setInt16 con Little Endian forzato (true)
  let offset = 44;

  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = abuffer.getChannelData(ch)[i];

      // Clipping rigoroso tra -1 e 1
      sample = Math.max(-1, Math.min(1, sample));

      // Conversione a 16-bit:
      // Se < 0 usiamo 0x8000 (32768), se > 0 usiamo 0x7FFF (32767)
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

      // Scrittura sicura
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}