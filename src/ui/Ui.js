import { eqBands, soundBanks } from "../audio/AudioUtils";

// ===========================================================================
// 1. HELPER COMPONENTS
// ===========================================================================

function createCommandsButtons() {
  const container = document.createElement("div");
  container.className = "command-buttons";
  
  [{id:"play-button", t:"▶︎"}, {id:"pause-button", t:"||"}, {id:"stop-button", t:"◼"}].forEach(btn => {
    const div = document.createElement("div");
    div.className = "old-button";
    div.id = btn.id;
    div.textContent = btn.t;
    container.appendChild(div);
  });
  return container;
}

/**
 * Crea una manopola (Knob) statica.
 */
function createKnob(id, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "knob-wrapper";

  const lbl = document.createElement("div");
  lbl.className = "knob-label";
  lbl.innerText = label;
  lbl.id = `label-${id}`;

  const body = document.createElement("div");
  body.className = "knob-body";
  body.id = `knob-${id}`;
  body.dataset.value = (id === 'vol') ? 0.8 : 0.0;

  const indicator = document.createElement("div");
  indicator.className = "knob-indicator";
  const startDeg = (id === 'vol') ? 81 : -135;
  indicator.style.transform = `translate(-50%, -100%) rotate(${startDeg}deg)`;

  const valDisplay = document.createElement("div");
  valDisplay.className = "knob-value";
  valDisplay.id = `val-${id}`;
  valDisplay.innerText = (id === 'vol') ? "80%" : "--";

  body.appendChild(indicator);
  wrapper.append(lbl, body, valDisplay);
  return wrapper;
}

/**
 * Genera la griglia di Floppy usando le IMMAGINI come nel tuo HTML.
 */
function createFloppyDeck() {
  const wrapper = document.createElement("div");
  wrapper.className = "fx-buttons-wrapper"; 

  const container = document.createElement("div");
  container.className = "fx-buttons"; // Classe originale dell'HTML

  const effects = [
    { id: "reverse", img: "reverse.png", alt: "Reverse FX" },
    { id: "delay", img: "delay.png", alt: "Delay FX" },
    { id: "distortion", img: "distort.png", alt: "Distort FX" }, // Nota: controlla se il file è distort.png o distortion.png
    { id: "bitcrush", img: "bitcrush.png", alt: "Bitcrush FX" }
  ];

  effects.forEach(fx => {
    const img = document.createElement("img");
    img.src = `./assets/img/${fx.img}`; // Percorso relativo alle immagini
    img.className = "fx-img";
    img.draggable = true;
    img.setAttribute("data-effect", fx.id);
    img.alt = fx.alt;

    // Evento Drag Nativo
    img.addEventListener("dragstart", (e) => {
       e.dataTransfer.setData("effectType", fx.id);
       e.dataTransfer.effectAllowed = "copy";
    });

    container.appendChild(img);
  });

  wrapper.appendChild(container);
  return wrapper;
}

function createBpmSection() {
    const wrapper = document.createElement("div");
    wrapper.className = "bpm-led-wrapper";
    
    const led = document.createElement("div");
    led.id = "bpm-led";
    led.className = "bpm-led";
    led.innerText = "tap BPM"; // Lowercase 'tap' come nel tuo HTML
    wrapper.appendChild(led);
    return wrapper;
}

// ===========================================================================
// 2. MAIN SECTIONS BUILDERS
// ===========================================================================

function createSampler() {
  const wrapper = document.createElement("div");
  wrapper.className = "sampler-wrapper";

  const sampler = document.createElement("div");
  sampler.className = "sampler border-shadow";
  sampler.id = "sample-drop";
  
  // Waveform Container
  const waveform = document.createElement("div");
  waveform.id = "waveform";
  const plus = document.createElement("div");
  plus.className = "plus-wrapper";
  plus.id = "plus-wrapper";
  plus.innerText = "DROP A SAMPLE...";
  waveform.appendChild(plus);
  
  // EQ Grid
  const eqGrid = document.createElement("div");
  eqGrid.className = "eq-grid";
  eqGrid.appendChild(createEqualizer()); // Usa la tua funzione sotto

  sampler.append(waveform, eqGrid);

  // Commands
  const commands = document.createElement("div");
  commands.className = "commands border-shadow";
  
  // Ricostruzione fedele della barra comandi HTML
  const pbLabel = document.createElement("div"); pbLabel.className="loop-label"; pbLabel.innerText="PLAYBACK";
  const cmdBtns = createCommandsButtons();
  
  const loopLabel = document.createElement("div"); loopLabel.className="loop-label"; loopLabel.innerText="LOOP";
  const loopBtns = document.createElement("div"); loopBtns.className="loop-buttons";
  [{id:"d2-button",t:"◀"}, {id:"loop-button",t:"↻"}, {id:"x2-button",t:"▶"}].forEach(b=>{
      const d=document.createElement("div"); d.className="old-button"; d.id=b.id; d.textContent=b.t; loopBtns.appendChild(d);
  });

  const recLabel = document.createElement("div"); recLabel.className="loop-label"; recLabel.innerText="REC";
  const recBtns = document.createElement("div"); recBtns.className="rec-buttons";
  const recDot = document.createElement("div"); recDot.className="old-button"; recDot.id="rec-button"; recDot.textContent="⦿";
  recBtns.appendChild(recDot);
  
  const trimBtns = document.createElement("div"); trimBtns.className="rec-buttons";
  const trimIcon = document.createElement("div"); trimIcon.className="old-button"; trimIcon.id="trim-btn"; trimIcon.textContent="✂";
  trimBtns.appendChild(trimIcon);

  commands.append(pbLabel, cmdBtns, loopLabel, loopBtns, recLabel, recBtns, trimBtns);
  
  wrapper.append(sampler, commands);
  return wrapper;
}

function createEffects() {
  const wrapper = document.createElement("div");
  wrapper.className = "effects border-shadow";
  
  // LABEL
  const label = document.createElement("div");
  label.className = "fx-label";
  label.textContent = "EFFECTS";

  // 1. FLOPPY IMAGES (Middle - Flex Grow)
  const floppyDeck = createFloppyDeck();

  // 2. KNOBS RACK (Static - Hardcoded here)
  const knobsRack = document.createElement("div");
  knobsRack.className = "knobs-rack";
  
  knobsRack.appendChild(createKnob("p1", "PARAM 1"));
  
  const freezeBtn = document.createElement("div");
  freezeBtn.className = "freeze-btn";
  freezeBtn.id = "freeze-btn";
  freezeBtn.innerText = "FREEZE";
  knobsRack.appendChild(freezeBtn);
  
  knobsRack.appendChild(createKnob("p2", "PARAM 2"));
  knobsRack.appendChild(createKnob("vol", "MASTER"));

  // 3. BPM (Bottom)
  const bpmSection = createBpmSection();

  wrapper.append(label, floppyDeck, knobsRack, bpmSection);
  return wrapper;
}

/**
 * Costruisce SOLO lo scheletro della colonna Banks.
 * Il contenuto (pad) verrà riempito da createBank chiamando l'evento change.
 */
function createBanksWrapper() {
  const wrapper = document.createElement("div");
  wrapper.className = "banks border-shadow";

  const menu = document.createElement("div");
  menu.className = "banks-menu";

  const label = document.createElement("div");
  label.className = "banks-label";
  label.innerText = "CHOOSE A SOUNDBANK";

  const select = document.createElement("select");
  select.name = "banks";
  select.id = "banks";
  select.className = "banks-dropdown";

  // Event listener per popolare i pad quando cambia il menu
  select.addEventListener("change", (e) => {
    createBank(e.target.value);
  });

  menu.append(label, select);

  const content = document.createElement("div");
  content.className = "banks-content";

  wrapper.append(menu, content);
  return wrapper;
}

// ===========================================================================
// 3. LOGIC & EXPORT (Equalizer & Bank Population)
// ===========================================================================

export default function createEqualizer() {
  const slidersContainer = document.createElement('div');
  slidersContainer.id = "sliders-wrapper";
  slidersContainer.className = "sliders-wrapper";

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

    slider.addEventListener("dblclick", () => {
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

function formatFreqLabel(freq) {
  return freq >= 1000 ? `${freq / 1000}kHz` : `${freq} Hz`;
}

// Funzione originale mantenuta per popolare i pad
function createBank(bankName) {
  const banksContent = document.querySelector(".banks-content");
  if (!banksContent) return;

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

export function initBankMenu() {
  const bankSelect = document.getElementById("banks");
  if (!bankSelect) return;

  bankSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = ""; 
  defaultOption.textContent = "-- SELECT SOUND BANK --";
  defaultOption.disabled = true; 
  defaultOption.selected = true;
  bankSelect.appendChild(defaultOption);

  Object.keys(soundBanks).forEach((bankName) => {
    const option = document.createElement("option");
    option.value = bankName;
    option.textContent = bankName;
    bankSelect.appendChild(option);
  });
}

// ===========================================================================
// MAIN BUILDER
// ===========================================================================

export function createPageDefault() {
  const wrapper = document.createElement("div");
  wrapper.className = "wrapper";

  wrapper.appendChild(createSampler());
  wrapper.appendChild(createEffects());     // Ora include Floppy Img + Knobs
  wrapper.appendChild(createBanksWrapper()); // Struttura HTML corretta per le banche

  const root = document.getElementById("root") || document.body;
  root.innerHTML = ""; 
  root.appendChild(wrapper);

  initBankMenu();
}