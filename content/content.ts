import { EdgeTTSClient, ProsodyOptions, OUTPUT_FORMAT } from 'edge-tts-client';

class ContentManager {
  private ttsClient: EdgeTTSClient | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioChunks: Uint8Array[] = [];
  private isPlaying = false;

  // Add these as class properties
  private readonly excludeSelectors = [
    'nav:not([aria-label="Main"])',
    'header:not([role="banner"])',
    'footer:not([role="contentinfo"])',
    'script', 'style', 'noscript', 'iframe',
    'select', 'textarea', 'button', 'label',
    'audio', 'video', 'dialog', 'embed',
    'menu', 'object',
    '.no-read-aloud',
    '[aria-hidden="true"]'
  ].join(',');

  private readonly blockElements = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'article', 'section', 'aside', 'blockquote',
    'li', 'td', 'th', 'dd', 'dt', 'figcaption',
    'pre', 'address'
  ]);

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
    const mainContent = this.getMainContent();
    return mainContent ? this.processContent(mainContent) : '';
  }

  private getMainContent(): Element | null {
    const mainSelectors = [
      'main[role="main"]',
      'article[role="article"]',
      'div[role="main"]',
      'main',
      'article',
      '#main-content',
      '.main-content',
      '.post-content',
      '.article-content'
    ];

    // Try to find main content first
    for (const selector of mainSelectors) {
      const element = document.querySelector(selector);
      if (element && this.hasSignificantContent(element)) {
        return element;
      }
    }

    // Fallback to body
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll(this.excludeSelectors).forEach(el => el.remove());
    return body;
  }

  private hasSignificantContent(element: Element): boolean {
    const text = element.textContent || '';
    return text.trim().length > 100;
  }

  private processContent(element: Element): string {
    const textBlocks: string[] = [];
    let currentBlock = '';
    let lastElement: Element | null = null;

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const style = window.getComputedStyle(parent);
          const isVisible = style.display !== 'none' &&
                          style.visibility !== 'hidden' &&
                          style.opacity !== '0' &&
                          node.textContent!.trim().length > 0;

          return isVisible ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node: Node | null;
    while (node = walker.nextNode()) {
      const parent = node.parentElement!;
      let text = this.cleanText(node.textContent || '');
      if (!text) continue;

      // Handle block-level elements
      if (lastElement &&
          parent !== lastElement &&
          (this.blockElements.has(parent.tagName.toLowerCase()) ||
           this.blockElements.has(lastElement.tagName.toLowerCase()))) {
        if (currentBlock) {
          textBlocks.push(this.finalizeBlock(currentBlock));
          currentBlock = '';
        }
      }

      // Special handling for list items
      if (parent.tagName === 'LI') {
        if (currentBlock) textBlocks.push(this.finalizeBlock(currentBlock));
        currentBlock = '• ' + text;
      } else {
        // Add appropriate spacing
        if (currentBlock && !currentBlock.endsWith(' ')) {
          currentBlock += ' ';
        }
        currentBlock += text;
      }

      lastElement = parent;
    }

    if (currentBlock) {
      textBlocks.push(this.finalizeBlock(currentBlock));
    }

    return this.finalizeText(textBlocks.join('\n\n'));
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')  // Remove zero-width spaces
      .trim();
  }

  private finalizeBlock(text: string): string {
    return text
      // Ensure proper spacing around punctuation
      .replace(/\s*([.,!?:;])\s*/g, '$1 ')
      // Fix multiple spaces
      .replace(/\s+/g, ' ')
      // Ensure sentence-ending punctuation
      .replace(/([a-zA-Z0-9])\s*$/g, '$1.')
      .trim();
  }

  private finalizeText(text: string): string {
    return text
      // Clean up URLs and email addresses
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
      // Remove common unwanted elements
      .replace(/^(Cookie Policy|Accept Cookies|Privacy Policy|Terms of Service)$/gm, '')
      // Fix redundant periods and spacing
      .replace(/\.+/g, '.')
      .replace(/\.\s*\./g, '.')
      // Ensure proper paragraph breaks
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }
}

new ContentManager();
