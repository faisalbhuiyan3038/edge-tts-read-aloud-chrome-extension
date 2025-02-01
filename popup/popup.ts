class PopupManager {
  private voiceSelect: HTMLSelectElement | null = null;
  private speedSlider: HTMLInputElement | null = null;
  private speedValue: HTMLSpanElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;

  constructor() {
    this.initializeElements();
    this.setupEventListeners();
    this.loadSavedSettings();
  }

  private async loadSavedSettings() {
    const settings = await chrome.storage.sync.get({
      voice: 'en-US-AvaNeural',
      speed: 1.0
    });

    if (this.voiceSelect) {
      this.voiceSelect.value = settings.voice;
    }
    if (this.speedSlider) {
      this.speedSlider.value = settings.speed.toString();
    }
    if (this.speedValue) {
      this.speedValue.textContent = `${settings.speed.toFixed(2)}x`;
    }
  }

  private initializeElements() {
    this.voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement;
    this.speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    this.speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    this.startButton = document.getElementById('startReading') as HTMLButtonElement;
    this.stopButton = document.getElementById('stopReading') as HTMLButtonElement;
  }

  private setupEventListeners() {
    if (!this.voiceSelect || !this.speedSlider || !this.speedValue || !this.startButton || !this.stopButton) {
      console.error('Required elements not found');
      return;
    }

    this.speedSlider.addEventListener('input', () => {
      const speed = parseFloat(this.speedSlider?.value || "1.0");
      if (this.speedValue) {
        this.speedValue.textContent = `${speed.toFixed(2)}x`;
      }
      chrome.storage.sync.set({ speed });
    });

    this.voiceSelect.addEventListener('change', () => {
      chrome.storage.sync.set({ voice: this.voiceSelect?.value });
    });

    this.startButton.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0].id && this.voiceSelect && this.speedSlider) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            {
              action: 'startReading',
              voice: this.voiceSelect.value,
              speed: parseFloat(this.speedSlider.value)
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('Error:', chrome.runtime.lastError);
              }
            }
          );
        }
      });
    });

    this.stopButton.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0].id) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { action: 'stopReading' },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('Error:', chrome.runtime.lastError);
              }
            }
          );
        }
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});