import browser from 'webextension-polyfill';

class PopupManager {
  private voiceSelect!: HTMLSelectElement;
  private speedSlider!: HTMLInputElement;
  private speedValue!: HTMLSpanElement;
  private startButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;

  constructor() {
    // Initialize elements with proper error handling
    const elements = this.initializeElements();
    if (!elements) {
      console.error('Failed to initialize popup elements');
      return;
    }

    this.voiceSelect = elements.voiceSelect;
    this.speedSlider = elements.speedSlider;
    this.speedValue = elements.speedValue;
    this.startButton = elements.startButton;
    this.stopButton = elements.stopButton;

    this.setupEventListeners();
    this.loadSavedSettings();
  }

  private initializeElements(): {
    voiceSelect: HTMLSelectElement;
    speedSlider: HTMLInputElement;
    speedValue: HTMLSpanElement;
    startButton: HTMLButtonElement;
    stopButton: HTMLButtonElement;
  } | null {
    const voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement;
    const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    const speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    const startButton = document.getElementById('startReading') as HTMLButtonElement;
    const stopButton = document.getElementById('stopReading') as HTMLButtonElement;

    if (!voiceSelect || !speedSlider || !speedValue || !startButton || !stopButton) {
      console.error('Required elements not found in popup');
      return null;
    }

    return {
      voiceSelect,
      speedSlider,
      speedValue,
      startButton,
      stopButton
    };
  }

  private async loadSavedSettings(): Promise<void> {
    try {
      const defaultSettings = {
        voice: 'en-US-AvaNeural',
        speed: 1.0
      };

      const result = await browser.storage.sync.get(defaultSettings);
      const settings = {
        voice: result.voice || defaultSettings.voice,
        speed: result.speed || defaultSettings.speed
      };

      this.voiceSelect.value = settings.voice;
      this.speedSlider.value = settings.speed.toString();
      this.speedValue.textContent = `${settings.speed.toFixed(2)}x`;
    } catch (error) {
      console.error('Failed to load settings:', error);
      // Set default values if loading fails
      this.voiceSelect.value = 'en-US-AvaNeural';
      this.speedSlider.value = '1.0';
      this.speedValue.textContent = '1.00x';
    }
  }

  private setupEventListeners(): void {
    // Speed slider event
    this.speedSlider.addEventListener('input', async () => {
      try {
        const speed = parseFloat(this.speedSlider.value);
        this.speedValue.textContent = `${speed.toFixed(2)}x`;
        await browser.storage.sync.set({ speed });
      } catch (error) {
        console.error('Failed to save speed setting:', error);
      }
    });

    // Voice select event
    this.voiceSelect.addEventListener('change', async () => {
      try {
        await browser.storage.sync.set({ voice: this.voiceSelect.value });
      } catch (error) {
        console.error('Failed to save voice setting:', error);
      }
    });

    // Start reading button
    this.startButton.addEventListener('click', async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) {
          throw new Error('No active tab found');
        }

        // First, store the source tab ID
        await browser.runtime.sendMessage({
          action: 'setSourceTab',
          tabId: tab.id
        });

        console.log('Starting reading in tab:', tab.id);
        const response = await browser.tabs.sendMessage(tab.id, {
          action: 'startReading',
          voice: this.voiceSelect.value,
          speed: parseFloat(this.speedSlider.value)
        });

        console.log('Received response:', response);

        if (!response) {
          throw new Error('No response received from content script');
        }

        if (response.status !== 'success') {
          throw new Error(response?.error || 'Failed to start reading: Invalid response');
        }
      } catch (error: any) {
        console.error('Failed to start reading:', error);
        // Check for content script not injected error
        if (error?.message?.includes('Could not establish connection')) {
          this.showError('Please refresh the page and try again. The content script needs to be reinitialized.');
        } else {
          this.showError('Failed to start reading. ' + (error.message || 'Unknown error occurred.'));
        }
      }
    });

    // Stop reading button
    this.stopButton.addEventListener('click', async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) {
          throw new Error('No active tab found');
        }

        console.log('Sending stopReading message to tab:', tab.id);
        const response = await browser.tabs.sendMessage(tab.id, {
          action: 'stopReading'
        });

        console.log('Received response:', response);

        if (!response || response.status !== 'success') {
          throw new Error(response?.error || 'Failed to stop reading: Invalid response');
        }
      } catch (error: any) {
        console.error('Failed to stop reading:', error);
        if (error?.message?.includes('Could not establish connection')) {
          this.showError('Please refresh the page and try again. The reader needs to be reinitialized.');
        } else {
          this.showError('Failed to stop reading. ' + (error.message || 'Unknown error occurred.'));
        }
      }
    });
  }

  private showError(message: string): void {
    // Create or update error message element
    let errorElement = document.getElementById('error-message');
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.id = 'error-message';
      errorElement.style.color = 'red';
      errorElement.style.padding = '10px';
      errorElement.style.marginTop = '10px';
      document.body.appendChild(errorElement);
    }
    errorElement.textContent = message;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      if (errorElement && errorElement.parentNode) {
        errorElement.parentNode.removeChild(errorElement);
      }
    }, 5000);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
