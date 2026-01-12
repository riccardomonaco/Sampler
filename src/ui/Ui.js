import { eqBands } from "../audio/AudioUtils";
import { bankService } from "../services/BankService.js";
import { Modal } from "../ui/Modal.js";

// ===========================================================================
// 1. HELPER COMPONENTS
// ===========================================================================

/**
 * Creates the hotbar commands buttons.
 *
 * @return {*} 
 */
function createCommandsButtons() {
  const container = document.createElement("div");
  container.className = "command-buttons";

  const buttons = [
    { id: "play-button", icon: "pixelart-icons-font-play" },
    { id: "pause-button", icon: "pixelart-icons-font-pause" },
    { id: "stop-button", isStop: true }
  ];

  buttons.forEach(btn => {
    const div = document.createElement("div");
    div.className = "old-button";
    div.id = btn.id;

    if (btn.isStop) {
      div.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="6" width="15" height="15" />
      </svg>
    `;
    } else {
      div.innerHTML = `<i class="${btn.icon}"></i>`;
    }

    container.appendChild(div);
  });

  return container;
}

/**
 * Creates static knob.
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
 * Generates floppy disk effects grid.
 */
function createFloppyDeck() {
  const wrapper = document.createElement("div");
  wrapper.className = "fx-buttons-wrapper";

  const container = document.createElement("div");
  container.className = "fx-buttons";

  const effects = [
    { id: "reverse", img: "reverse.png", alt: "Reverse FX" },
    { id: "delay", img: "delay.png", alt: "Delay FX" },
    { id: "distortion", img: "distort.png", alt: "Distort FX" },
    { id: "bitcrush", img: "bitcrush.png", alt: "Bitcrush FX" }
  ];

  effects.forEach(fx => {
    const img = document.createElement("img");
    img.src = `./assets/img/${fx.img}`;
    img.className = "fx-img";
    img.draggable = true;
    img.setAttribute("data-effect", fx.id);
    img.alt = fx.alt;

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
  led.innerText = "tap BPM";
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
  eqGrid.appendChild(createEqualizer());

  sampler.append(waveform, eqGrid);

  // Commands
  const commands = document.createElement("div");
  commands.className = "commands border-shadow";

  // Commands hotbar
  const pbLabel = document.createElement("div"); pbLabel.className = "loop-label"; pbLabel.innerText = "PLAYBACK";
  const cmdBtns = createCommandsButtons();

  const loopLabel = document.createElement("div");
  loopLabel.className = "loop-label";
  loopLabel.innerText = "LOOP";

  const loopBtns = document.createElement("div");
  loopBtns.className = "loop-buttons";

  // Loop buttons
  const loopControls = [
    { id: "d2-button", icon: "pixelart-icons-font-prev" },
    { id: "loop-button", icon: "pixelart-icons-font-reload" },
    { id: "x2-button", icon: "pixelart-icons-font-next" }
  ];

  loopControls.forEach(b => {
    const d = document.createElement("div");
    d.className = "old-button";
    d.id = b.id;
    d.innerHTML = `<i class="${b.icon}"></i>`;
    loopBtns.appendChild(d);
  });

  // --- UTILS SECTION ---
  const utilsLabel = document.createElement("div");
  utilsLabel.className = "loop-label";
  utilsLabel.innerText = "UTILS";

  const utilsBtns = document.createElement("div");
  utilsBtns.className = "rec-buttons";

  /*   // 1. SNAP
    const snapBtn = document.createElement("div");
    snapBtn.className = "old-button";
    snapBtn.id = "snap-btn";
    snapBtn.title = "Snap to Grid";
  
    // Inseriamo l'SVG direttamente. fill="currentColor" è il segreto per farla colorare col CSS.
    snapBtn.innerHTML = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <rect x="5" y="4" width="4" height="4" />
        <rect x="5" y="10" width="4" height="5" />
  
        <rect x="15" y="4" width="4" height="4" />
        <rect x="15" y="10" width="4" height="5" />
        
        <rect x="5" y="15" width="5" height="2" />
        <rect x="14" y="15" width="5" height="2" />
        
        <rect x="7" y="17" width="10" height="2" />
        
        <rect x="9" y="19" width="6" height="1" />
      </svg>
    `; */

  // 2. CUT
  const cutBtn = document.createElement("div");
  cutBtn.className = "old-button";
  cutBtn.id = "trim-btn";
  cutBtn.title = "Trim Audio";
  cutBtn.innerHTML = '<i class="pixelart-icons-font-cut"></i>';

  // 3. EXPORT (Download)
  const exportBtn = document.createElement("div");
  exportBtn.className = "old-button";
  exportBtn.id = "export-btn";
  exportBtn.title = "Export to WAV";
  exportBtn.innerHTML = '<i class="pixelart-icons-font-download"></i>';

  const saveBtn = document.createElement("div");
  saveBtn.className = "old-button";
  saveBtn.id = "save-bank-btn";
  saveBtn.title = "Save to Current Bank";
  saveBtn.innerHTML = '<i class="pixelart-icons-font-save"></i>';

  utilsBtns.append(cutBtn, saveBtn, exportBtn);

  commands.append(pbLabel, cmdBtns, loopLabel, loopBtns, utilsLabel, utilsBtns);
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

  // 2. KNOBS RACK
  const knobsRack = document.createElement("div");
  knobsRack.className = "knobs-rack hidden";
  knobsRack.id = "knobs-rack";

  knobsRack.appendChild(createKnob("p1", "PARAM 1"));
  knobsRack.appendChild(createKnob("p2", "PARAM 2"));
  knobsRack.appendChild(createKnob("vol", "FX LEVEL"));

  // 3. BPM (Bottom)
  const bpmSection = createBpmSection();

  wrapper.append(label, floppyDeck, knobsRack, bpmSection);
  return wrapper;
}

/**
 * Creates skeleton of banks area.
 * Content will be placed by createBank.
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

  select.addEventListener("change", async (e) => {
    const value = e.target.value;

    if (value && value !== "__NEW_BANK__") {
      delBtn.style.display = "flex";
    } else {
      delBtn.style.display = "none";
    }

    if (value === "__NEW_BANK__") {
      const newName = await Modal.show('prompt', "Enter new Sound Bank name:");

      if (newName && newName.trim() !== "") {
        const success = await bankService.createBank(newName);

        if (success) {
          initBankMenu();
          select.value = newName;
          createBank(newName);
        } else {
          await Modal.show('alert', "Bank already exists or invalid name.");
          select.value = "";
          delBtn.style.display = "none";
        }
      } else {
        select.value = "";
        delBtn.style.display = "none";
      }
    } else {
      createBank(value);
    }
  });

  select.addEventListener("change", (e) => {
    createBank(e.target.value);
  });

  menu.append(label, select);

  const content = document.createElement("div");
  content.className = "banks-content";

  const footer = document.createElement("div");
  footer.className = "banks-footer";

  const delBtn = document.createElement("div");
  delBtn.id = "delete-bank-btn";
  delBtn.className = "old-button delete-bank-btn";
  delBtn.innerText = "DELETE BANK";
  delBtn.style.display = "none";

  delBtn.addEventListener("click", async () => {
    const currentBank = select.value;
    if (!currentBank || currentBank === "__NEW_BANK__") return;

    const confirmed = await Modal.show('confirm', `PERMANENTLY DELETE\n"${currentBank}"?`);

    if (confirmed) {
      const success = await bankService.deleteBank(currentBank);
      if (success) {
        initBankMenu();
        createBank(null); 
        delBtn.style.display = "none";
        await Modal.show('alert', "Bank deleted successfully.");
      } else {
        await Modal.show('alert', "Error deleting bank.");
      }
    }
  });

  footer.appendChild(delBtn);

  wrapper.append(menu, content, footer);
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

export function createBank(bankName) {
  const banksContent = document.querySelector(".banks-content");
  if (!banksContent) return;

  banksContent.innerHTML = "";
  if (!bankName || bankName === "__NEW_BANK__") return;

  const samples = bankService.localCache[bankName] || [];

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

    const delBtn = document.createElement("div");
    delBtn.className = "pad-delete-btn";
    delBtn.innerHTML = '<i class="pixelart-icons-font-trash"></i>';
    delBtn.title = "Delete Sample";

    delBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const confirmed = await Modal.show('confirm', `Delete "${sample.name}"?`);

      if (confirmed) {
        pad.style.opacity = "0.5";
        pad.style.pointerEvents = "none";

        try {
          await bankService.deleteSample(bankName, sample);
          createBank(bankName);
        } catch (err) {
          console.error(err);
          alert("Errore durante l'eliminazione");
          pad.style.opacity = "1";
        }
      }
    });

    pad.appendChild(delBtn);
    banksContent.appendChild(pad);
  });

  const addPad = document.createElement("div");
  addPad.classList.add("sample-pad", "add-sample-pad");
  addPad.innerHTML = `<span>+</span>`;
  addPad.title = "Add Sample from Disk";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "audio/*";
  fileInput.style.display = "none";

  addPad.addEventListener("click", () => {
    if (!addPad.classList.contains("loading")) {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const originalName = file.name.replace(/\.[^/.]+$/, "");

    let chosenName = await Modal.show('prompt', "Rename your sample:", originalName);

    if (chosenName === null) {
      fileInput.value = "";
      return;
    }

    chosenName = chosenName.trim();
    if (chosenName === "") {
      chosenName = originalName;
    }

    let displayName = chosenName;
    if (displayName.length > 9) {
      displayName = displayName.substring(0, 9) + ".";
    }

    addPad.classList.add("loading");
    addPad.innerHTML = `<i class="pixelart-icons-font-clock"></i>`;

    try {
      const colors = ["var(--color-red)", "var(--color-ambra)", "var(--color-green)", "var(--color-blu)"];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      await bankService.addSample(bankName, displayName, file, randomColor);
      createBank(bankName);
    } catch (err) {
      console.error(err);
      alert("Upload fallito");
      addPad.classList.remove("loading");
      addPad.innerHTML = `<span>+</span>`;
    }
  });

  banksContent.appendChild(addPad);
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
  defaultOption.hidden = true;
  bankSelect.appendChild(defaultOption);

  Object.keys(bankService.localCache).forEach((bankName) => {
    const option = document.createElement("option");
    option.value = bankName;
    option.textContent = bankName;
    bankSelect.appendChild(option);
  });

  const addOption = document.createElement("option");
  addOption.value = "__NEW_BANK__"; // Valore speciale
  addOption.textContent = "+ CREATE NEW BANK";
  addOption.style.fontWeight = "bold";
  addOption.style.color = "var(--color-green)";
  bankSelect.appendChild(addOption);
}

// ===========================================================================
// MAIN BUILDER
// ===========================================================================

export function createPageDefault() {
  const wrapper = document.createElement("div");
  wrapper.className = "wrapper";

  wrapper.appendChild(createSampler());
  wrapper.appendChild(createEffects());
  wrapper.appendChild(createBanksWrapper());

  const root = document.getElementById("root") || document.body;
  root.innerHTML = "";
  root.appendChild(wrapper);

  initBankMenu();
}