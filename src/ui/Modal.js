/**
 * Modal.js
 * Sistema di finestre modali robusto e autorigenerante.
 */

class ModalSystem {
  constructor() {
    this.overlay = null;
    this.resolvePromise = null;
    this.els = {};
    
    // Setup listener globali (fatto una volta sola)
    this.setupGlobalListeners();
  }

  /**
   * Controlla se l'HTML esiste, altrimenti lo crea.
   * Questo risolve il problema di Ui.js che svuota il body.
   */
  ensureDom() {
    // Se l'overlay esiste nel documento, siamo a posto
    if (this.overlay && document.body.contains(this.overlay)) {
        return;
    }

    // Altrimenti (ri)creiamo tutto
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    
    this.overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header" id="modal-title">SYSTEM MESSAGE</div>
        <div class="modal-body" id="modal-message"></div>
        <input type="text" class="modal-input" id="modal-input" style="display:none;">
        <div class="modal-footer" id="modal-footer"></div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    
    // Aggiorniamo i riferimenti
    this.els = {
      title: this.overlay.querySelector('#modal-title'),
      msg: this.overlay.querySelector('#modal-message'),
      input: this.overlay.querySelector('#modal-input'),
      footer: this.overlay.querySelector('#modal-footer')
    };
  }

  setupGlobalListeners() {
    document.addEventListener('keydown', (e) => {
      // Funziona solo se il modale è attivo
      if (!this.overlay || !this.overlay.classList.contains('active')) return;

      if (e.key === 'Escape') {
        this.close(null); // Cancel
      }
      if (e.key === 'Enter') {
          // Clicca il tasto conferma se esiste
          const confirmBtn = this.els.footer ? this.els.footer.querySelector('.btn-confirm') : null;
          if(confirmBtn) confirmBtn.click();
      }
    });
  }

  // Metodo pubblico
  show(type, message, defaultValue = "") {
    return new Promise((resolve) => {
      // 1. AUTORIGENERAZIONE: Assicurati che l'HTML esista prima di fare qualsiasi cosa
      this.ensureDom();

      this.resolvePromise = resolve;
      
      // 2. Reset UI
      this.els.msg.innerText = message;
      this.els.footer.innerHTML = '';
      this.els.input.style.display = 'none';
      this.els.input.value = '';

      // 3. Configurazione bottoni
      if (type === 'alert') {
        this.els.title.innerText = "ATTENTION";
        this.createBtn("OK", "btn-confirm", () => this.close(true));
      } 
      else if (type === 'confirm') {
        this.els.title.innerText = "CONFIRMATION";
        this.createBtn("CANCEL", "btn-cancel", () => this.close(false));
        this.createBtn("YES", "btn-confirm", () => this.close(true));
      } 
      else if (type === 'prompt') {
        this.els.title.innerText = "INPUT REQUIRED";
        this.els.input.style.display = 'block';
        this.els.input.value = defaultValue;
        
        this.createBtn("CANCEL", "btn-cancel", () => this.close(null));
        this.createBtn("OK", "btn-confirm", () => this.close(this.els.input.value));
      }

      // 4. Mostra con un piccolo delay per l'animazione CSS
      requestAnimationFrame(() => {
          this.overlay.classList.add('active');
          if(type === 'prompt') {
              setTimeout(() => {
                  this.els.input.focus();
                  this.els.input.select();
              }, 50);
          }
      });
    });
  }

  createBtn(text, className, onClick) {
    const btn = document.createElement('button');
    btn.className = `modal-btn ${className}`;
    btn.innerText = text;
    btn.onclick = onClick;
    this.els.footer.appendChild(btn);
  }

  close(value) {
    if (!this.overlay) return;
    this.overlay.classList.remove('active');
    
    // Risolvi la promessa
    if (this.resolvePromise) {
      this.resolvePromise(value);
      this.resolvePromise = null;
    }
  }
}

export const Modal = new ModalSystem();