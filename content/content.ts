import { EdgeTTSClient, ProsodyOptions, OUTPUT_FORMAT } from 'edge-tts-client';

class ContentManager {
  private ttsClient: EdgeTTSClient | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioChunks: Uint8Array[] = [];
  private isPlaying = false;

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'startReading':
          this.startReading(
            this.extractPageText(),
            message.voice,
            message.speed
          );
          sendResponse({ status: 'started' }); // Immediately respond
          break;

        case 'readSelection':
          this.startReading(
            message.text,
            undefined,
            undefined
          );
          sendResponse({ status: 'started' });
          break;

        case 'stopReading':
          this.stopReading();
          sendResponse({ status: 'stopped' });
          break;
      }
    });
  }

  private async startReading(text: string, voice?: string, speed?: number) {
    try {
      // Stop any existing playback
      this.stopReading();

      // Get settings if not provided
      if (!voice || !speed) {
        const settings = await this.getSettings();
        voice = voice || settings.voice;
        speed = speed || settings.speed;
      }

      this.ttsClient = new EdgeTTSClient();
      await this.ttsClient.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const options = new ProsodyOptions();
      options.rate = speed;
      
      // Initialize audio context
      this.audioContext = new AudioContext();
      this.audioChunks = [];
      
      const stream = this.ttsClient.toStream(text, options);

      stream.on('data', async (chunk) => {
        this.audioChunks.push(chunk);
        if (!this.isPlaying) {
          this.isPlaying = true;
          await this.playNextChunk();
        }
      });

      stream.on('end', () => {
        this.ttsClient = null;
      });

    } catch (error) {
      console.error('TTS Error:', error);
      this.isPlaying = false;
    }
  }

  private async playNextChunk() {
    if (!this.isPlaying || !this.audioContext || this.audioChunks.length === 0) {
      this.isPlaying = false;
      return;
    }

    try {
      // Combine chunks into one array
      const combinedChunks = new Uint8Array(
        this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0)
      );
      
      let offset = 0;
      this.audioChunks.forEach(chunk => {
        combinedChunks.set(chunk, offset);
        offset += chunk.length;
      });
      
      this.audioChunks = [];

      const audioBuffer = await this.audioContext.decodeAudioData(combinedChunks.buffer);
      
      this.sourceNode = this.audioContext.createBufferSource();
      this.sourceNode.buffer = audioBuffer;
      this.sourceNode.connect(this.audioContext.destination);
      
      this.sourceNode.onended = () => {
        if (this.audioChunks.length > 0) {
          this.playNextChunk();
        } else {
          this.isPlaying = false;
        }
      };
      
      this.sourceNode.start();
    } catch (error) {
      console.error('Audio playback error:', error);
      this.isPlaying = false;
    }
  }

  private async getSettings(): Promise<{ voice: string; speed: number }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        resolve(response || { voice: 'en-US-AvaNeural', speed: 1.0 });
      });
    });
  }

  private stopReading() {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      this.sourceNode = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.ttsClient) {
      this.ttsClient.close();
      this.ttsClient = null;
    }
    
    this.audioChunks = [];
    this.isPlaying = false;
  }

  private extractPageText(): string {
    // Try multiple methods to get text content
    const textContent = this.getTextFromMultipleSources();
    return this.processText(textContent);
  }

  private getTextFromMultipleSources(): string {
    let content = '';

    // Method 1: Try getting main content first
    const mainContent = document.querySelector('main, article, #main, #content, .main, .content');
    if (mainContent) {
      content = mainContent.textContent || '';
    }

    // Method 2: If no main content, try getting body excluding navigation and footer
    if (!content.trim()) {
      const body = document.body;
      const elementsToExclude = 'nav, header, footer, script, style, noscript, iframe';
      const clone = body.cloneNode(true) as HTMLElement;

      // Remove unwanted elements from clone
      elementsToExclude.split(',').forEach(selector => {
        clone.querySelectorAll(selector.trim()).forEach(el => el.remove());
      });

      content = clone.textContent || '';
    }

    // Method 3: If still no content, try getting visible text nodes
    if (!content.trim()) {
      content = this.getVisibleTextNodes(document.body);
    }

    // Method 4: Last resort - get all body text
    if (!content.trim()) {
      content = document.body.innerText || document.body.textContent || '';
    }

    return content;
  }

  private getVisibleTextNodes(node: Node): string {
    let text = '';
    const walk = document.createTreeWalker(
      node,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Check if the text node is visible
          const element = node.parentElement;
          if (!element) return NodeFilter.FILTER_REJECT;

          const style = window.getComputedStyle(element);
          const isVisible = style.display !== 'none' &&
                           style.visibility !== 'hidden' &&
                           style.opacity !== '0';

          return isVisible ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let currentNode;
    while (currentNode = walk.nextNode()) {
      text += currentNode.textContent + ' ';
    }

    return text;
  }

  private processText(text: string): string {
    return text
      // Remove extra whitespace
      .replace(/\s+/g, ' ')
      // Remove common unwanted elements
      .replace(/^(Cookie Policy|Accept Cookies|Privacy Policy|Terms of Service)$/gm, '')
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '')
      // Remove email addresses
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
      // Remove special characters
      .replace(/[^\w\s.,!?-]/g, ' ')
      // Split into sentences and filter empty ones
      .split(/[.!?]+/)
      .filter(sentence => sentence.trim().length > 0)
      // Join sentences back together
      .join('. ')
      .trim();
  }
}

new ContentManager();
