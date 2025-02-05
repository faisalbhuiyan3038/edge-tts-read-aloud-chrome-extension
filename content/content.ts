import { EdgeTTSClient, ProsodyOptions, OUTPUT_FORMAT } from 'edge-tts-client';
import { Readability } from '@mozilla/readability';
import { EventEmitter } from 'events';

interface Sentence {
  text: string;
  index: number;
  isHeading?: boolean;
}

interface ParsedArticle {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
}

interface TTSEventMap {
  data: (chunk: Uint8Array) => void;
  end: () => void;
  error: (error: Error) => void;
}

interface TTSStream {
  on<K extends keyof TTSEventMap>(event: K, listener: TTSEventMap[K]): this;
  once<K extends keyof TTSEventMap>(event: K, listener: TTSEventMap[K]): this;
  emit<K extends keyof TTSEventMap>(event: K, ...args: Parameters<TTSEventMap[K]>): boolean;
  removeListener<K extends keyof TTSEventMap>(event: K, listener: TTSEventMap[K]): this;
  removeAllListeners(event?: keyof TTSEventMap): this;
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  listeners<K extends keyof TTSEventMap>(event: K): TTSEventMap[K][];
  rawListeners<K extends keyof TTSEventMap>(event: K): TTSEventMap[K][];
  eventNames(): (keyof TTSEventMap)[];
  listenerCount<K extends keyof TTSEventMap>(event: K): number;
  prependListener<K extends keyof TTSEventMap>(event: K, listener: TTSEventMap[K]): this;
  prependOnceListener<K extends keyof TTSEventMap>(event: K, listener: TTSEventMap[K]): this;
}

class ContentManager {
  private ttsClient: EdgeTTSClient | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioChunks: Uint8Array[] = [];
  private isPlaying = false;
  private isPaused = false;
  private currentSentenceIndex = 0;
  private sentences: Sentence[] = [];
  private currentStream: TTSStream | null = null;
  private currentVoice: string | null = null;
  private currentSpeed: number | null = null;

  private readonly excludeSelectors = [
    'select', 'textarea', 'button', 'label', 'audio', 'video',
    'dialog', 'embed', 'menu', 'nav:not([role="main"])',
    'noframes', 'noscript', 'object', 'script', 'style', 'svg',
    'aside', 'footer', '#footer', '.no-read-aloud',
    '[aria-hidden="true"]', '[role="complementary"]',
    'sup',
    '[style*="float: right"]',
    '[style*="position: fixed"]'
  ].join(',');

  private readonly blockElements = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'article', 'section', 'blockquote',
    'li', 'td', 'th', 'dd', 'dt', 'figcaption',
    'pre', 'address'
  ]);

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message);

      try {
        switch (message.action) {
          case 'startReading':
            if (message.startFromIndex !== undefined) {
              // Start reading from specific index
              this.readFromIndex(message.startFromIndex)
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => {
                  console.error('Start reading from index error:', error);
                  sendResponse({ status: 'error', error: error instanceof Error ? error.message : String(error) });
                });
            } else {
              // Start reading from beginning
              this.startReading(message.voice, message.speed)
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => {
                  console.error('Start reading error:', error);
                  sendResponse({ status: 'error', error: error instanceof Error ? error.message : String(error) });
                });
            }
            break;

          case 'readFromIndex':
            if (typeof message.index === 'number') {
              this.readFromIndex(message.index)
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => {
                  console.error('Read from index error:', error);
                  sendResponse({ status: 'error', error: error instanceof Error ? error.message : String(error) });
                });
            } else {
              console.error('Invalid index type:', message.index);
              sendResponse({ status: 'error', error: 'Invalid index type' });
            }
            break;

          case 'readSelection':
            const selection = window.getSelection()?.toString().trim();
            if (selection) {
              this.startReadingText(selection, undefined, undefined)
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => {
                  console.error('Read selection error:', error);
                  sendResponse({ status: 'error', error: error instanceof Error ? error.message : String(error) });
                });
            } else {
              sendResponse({ status: 'error', error: 'No text selected' });
            }
            break;

          case 'stopReading':
            try {
              this.stopReading(message.closeReader);
              this.currentSentenceIndex = 0; // Reset to beginning
              sendResponse({ status: 'success' });
            } catch (error) {
              console.error('Stop reading error:', error);
              sendResponse({ status: 'error', error: 'Failed to stop reading' });
            }
            break;

          case 'pauseReading':
            try {
              this.pauseReading();
              sendResponse({ status: 'success' });
            } catch (error) {
              console.error('Pause reading error:', error);
              sendResponse({ status: 'error', error: 'Failed to pause reading' });
            }
            break;

          case 'resumeReading':
            this.resumeReading()
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => {
                console.error('Resume reading error:', error);
                sendResponse({ status: 'error', error: error instanceof Error ? error.message : String(error) });
              });
            break;
        }
      } catch (error) {
        console.error('Message handling error:', error);
        sendResponse({ status: 'error', error: 'Failed to process message' });
      }

      return true; // Keep the message channel open for async response
    });
  }

  private async startReading(voice?: string, speed?: number) {
    try {
      // Stop any existing playback
      this.stopReading();

      // Parse the page content using Readability
      const article = this.parsePageContent();
      if (!article) {
        throw new Error('Could not parse page content');
      }

      // Initialize sentences array from the article content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = article.content;
      const textContent = this.extractTextContent(tempDiv);
      this.sentences = this.splitIntoSentences(textContent);
      console.log('Initialized sentences array:', this.sentences.length);

      // Format the content for the reader, using the same sentences array
      const formattedContent = this.formatArticleContent(article, this.sentences);

      // Open reader tab with the parsed text and wait for it to be ready
      const response = await chrome.runtime.sendMessage({
        action: 'openReader',
        text: formattedContent,
        title: article.title,
        metadata: {
          author: article.byline,
          siteName: article.siteName,
          excerpt: article.excerpt
        }
      });

      if (response?.status === 'error') {
        throw new Error(response.error);
      }

      // Wait for the reader tab to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start reading the text
      await this.startReadingText(textContent, voice, speed);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Failed to start reading:', errorMessage);
      chrome.runtime.sendMessage({
        action: 'updateReaderContent',
        error: errorMessage
      });
      throw new Error(errorMessage);
    }
  }

  private parsePageContent(): ParsedArticle | null {
    // Clone the document to avoid modifying the original
    const documentClone = document.cloneNode(true) as Document;

    // Create new readability object
    const reader = new Readability(documentClone, {
      keepClasses: true,
      classesToPreserve: ['chapter', 'article', 'section', 'title']
    });

    // Parse the content
    return reader.parse();
  }

  private extractTextContent(element: Element): string {
    let text = '';
    const walk = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;
          if (parent?.tagName === 'SCRIPT' || parent?.tagName === 'STYLE') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walk.nextNode()) {
      text += node.textContent + ' ';
    }
    return text.trim();
  }

  private formatArticleContent(article: ParsedArticle, sentences: Sentence[]): string {
    let content = '';

    // Add title
    if (article.title) {
      content += `<h1>${article.title}</h1>\n\n`;
    }

    // Add metadata
    if (article.byline || article.siteName) {
      content += '<div class="article-metadata">\n';
      if (article.byline) content += `<p class="author">By ${article.byline}</p>\n`;
      if (article.siteName) content += `<p class="site-name">From ${article.siteName}</p>\n`;
      content += '</div>\n\n';
    }

    // Add main content with sentence markers
    const mainContent = article.content;
    content += '<div class="reader-text">\n';

    // Split content into text nodes while preserving HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = mainContent;

    let currentSentenceIndex = 0;
    const processNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!text.trim()) return text;

        // Find the corresponding sentence
        const sentence = sentences[currentSentenceIndex];
        if (sentence && text.includes(sentence.text)) {
          currentSentenceIndex++;
          return `<span data-sentence-index="${sentence.index}">${sentence.text} </span>`;
        }
        return text;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
          return '';
        }
        const childContent: string = Array.from(node.childNodes)
          .map(child => processNode(child))
          .join('');
        return `<${element.tagName.toLowerCase()}>${childContent}</${element.tagName.toLowerCase()}>`;
      }
      return '';
    };

    content += Array.from(tempDiv.childNodes).map(node => processNode(node)).join('');
    content += '</div>\n';

    return content;
  }

  private async startReadingText(text: string, voice?: string, speed?: number) {
    try {
      console.log('Starting to read text:', { textLength: text.length, voice, speed });

      // Get settings if not provided
      if (!voice || !speed) {
        const settings = await this.getSettings();
        this.currentVoice = voice || settings.voice;
        this.currentSpeed = speed || settings.speed;
      } else {
        this.currentVoice = voice;
        this.currentSpeed = speed;
      }

      // Only initialize sentences if they haven't been initialized yet
      if (this.sentences.length === 0) {
        this.sentences = this.splitIntoSentences(text);
        console.log('Split text into sentences:', this.sentences.length);
      } else {
        console.log('Using existing sentences array:', this.sentences.length);
      }

      this.currentSentenceIndex = 0;
      this.isPaused = false;
      this.isPlaying = true;

      // Start reading sentences
      await this.readNextSentence(this.currentVoice, this.currentSpeed);
    } catch (error) {
      console.error('TTS Error:', error);
      this.isPlaying = false;
      throw error;
    }
  }

  private splitIntoSentences(text: string): Sentence[] {
    // Remove extra whitespace and normalize line endings
    text = text.replace(/\s+/g, ' ')
      .replace(/([.!?])\s+/g, '$1\n')
      .trim();

    // Split into sentences
    const sentences = text.split(/\n+/);

    return sentences.map((text, index) => {
      const trimmedText = text.trim();
      return {
        text: trimmedText,
        index,
        isHeading: this.isHeading(trimmedText)
      };
    }).filter(sentence => sentence.text.length > 0);
  }

  private isHeading(text: string): boolean {
    // Check if the text looks like a heading
    return (
      // All caps with no lowercase
      /^[A-Z0-9\s.,!?-]+$/.test(text) ||
      // Short phrase ending with colon
      /^.{1,50}:$/.test(text) ||
      // Numbered heading
      /^\d+\.\s+.{1,50}$/.test(text)
    );
  }

  private async readNextSentence(voice: string, speed: number) {
    if (this.isPaused || !this.isPlaying || this.currentSentenceIndex >= this.sentences.length) {
      if (this.currentSentenceIndex >= this.sentences.length) {
        this.stopReading(true);
      }
      return;
    }

    const sentence = this.sentences[this.currentSentenceIndex];
    console.log('Reading sentence:', { index: this.currentSentenceIndex, text: sentence.text });

    try {
      // Read the sentence and wait for it to complete
      await this.readSentence(sentence.text, voice, speed);

      // Add a small delay between sentences for better pacing
      await new Promise(resolve => setTimeout(resolve, 250));

      // Check if we should continue after the sentence is finished
      if (!this.isPaused && this.isPlaying) {
        // Move to next sentence
        this.currentSentenceIndex++;
        await this.readNextSentence(voice, speed);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Error reading sentence:', errorMessage);
      this.stopReading(true);
    }
  }

  private async readSentence(text: string, voice: string, speed: number): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        if (!this.ttsClient) {
          console.log('Creating new TTS client');
          this.ttsClient = new EdgeTTSClient();
        }

        // Initialize audio context if needed
        if (!this.audioContext) {
          console.log('Creating new AudioContext');
          this.audioContext = new AudioContext();
        }

        const audioContext = this.audioContext;
        if (!audioContext) {
          throw new Error('Failed to create audio context');
        }

        // Make sure audio context is running
        if (audioContext.state !== 'running') {
          console.log('Resuming audio context');
          await audioContext.resume();
        }

        // Store the current sentence promise resolver
        let currentSentenceResolver = resolve;

        // Function to clean up current playback
        const cleanup = () => {
          if (this.sourceNode) {
            try {
              this.sourceNode.stop();
              this.sourceNode.disconnect();
            } catch (e) {
              console.error('Error cleaning up audio:', e);
            }
            this.sourceNode = null;
          }
        };

        console.log('Setting TTS metadata:', { voice });
        await this.ttsClient.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const options = new ProsodyOptions();
        options.rate = speed;
        console.log('TTS options:', options);

        // Clear any existing audio chunks
        this.audioChunks = [];
        this.isPlaying = true;

        // Collect all chunks before playing
        const allChunks: Uint8Array[] = [];

        console.log('Starting TTS stream for text:', text);
        const stream = this.ttsClient.toStream(text, options) as unknown as TTSStream;
        this.currentStream = stream;
        console.log('Stream created:', stream);

        if (!stream || typeof stream.on !== 'function') {
          throw new Error('Invalid stream object');
        }

        // Set up event handlers
        stream.on('data', (chunk: Uint8Array) => {
          if (this.isPaused) {
            cleanup();
            currentSentenceResolver();
            return;
          }
          console.log('Received audio chunk:', chunk.length, 'bytes');
          allChunks.push(chunk);
        });

        stream.on('end', async () => {
          if (this.isPaused) {
            cleanup();
            currentSentenceResolver();
            return;
          }

          console.log('Stream ended, total chunks:', allChunks.length);
          if (allChunks.length === 0) {
            console.error('Stream ended without receiving any data');
            reject(new Error('No audio data received'));
            return;
          }

          try {
            // Combine all chunks into one buffer
            const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combinedBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of allChunks) {
              combinedBuffer.set(chunk, offset);
              offset += chunk.length;
            }

            // Create audio buffer
            const audioBuffer = await audioContext.decodeAudioData(combinedBuffer.buffer);
            console.log('Audio buffer created:', { duration: audioBuffer.duration, channels: audioBuffer.numberOfChannels });

            if (this.isPaused) {
              cleanup();
              currentSentenceResolver();
              return;
            }

            // Create and connect source node
            const sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(audioContext.destination);

            // Store the source node
            this.sourceNode = sourceNode;

            // When audio ends, resolve the promise
            sourceNode.onended = () => {
              console.log('Audio finished playing');
              this.sourceNode = null;
              currentSentenceResolver();
            };

            // Start playing
            sourceNode.start();
            console.log('Started playing audio');

          } catch (error) {
            console.error('Audio playback error:', error);
            reject(error);
          }
        });

      } catch (error) {
        console.error('Error reading sentence:', error);
        reject(error instanceof Error ? error : new Error('Unknown error'));
      }
    });
  }

  private async resumeReading() {
    console.log('Resuming playback from sentence index:', this.currentSentenceIndex);
    if (!this.currentVoice || !this.currentSpeed) {
      const settings = await this.getSettings();
      this.currentVoice = settings.voice;
      this.currentSpeed = settings.speed;
    }

    this.isPaused = false;
    this.isPlaying = true;

    await this.readNextSentence(this.currentVoice, this.currentSpeed);
  }

  private pauseReading() {
    console.log('Pausing playback');
    this.isPaused = true;

    // Stop current audio
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        console.error('Error stopping audio:', e);
      }
      this.sourceNode = null;
    }

    // Clear any pending audio
    this.audioChunks = [];

    // Keep the current sentence index for resuming later
    console.log('Paused at sentence index:', this.currentSentenceIndex);
  }

  private async getSettings(): Promise<{ voice: string; speed: number }> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response || { voice: 'en-US-AvaNeural', speed: 1.0 });
        }
      });
    });
  }

  private async readFromIndex(index: number) {
    console.log('Reading from index:', index, 'Total sentences:', this.sentences.length);

    if (this.sentences.length === 0) {
      console.error('No sentences available to read from');
      throw new Error('No sentences available to read from');
    }

    if (index >= this.sentences.length) {
      console.error('Index out of bounds:', index, 'Total sentences:', this.sentences.length);
      throw new Error('Index out of bounds');
    }

    console.log('Will start reading from sentence:', this.sentences[index]);

    // Force stop any existing playback
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        console.error('Error stopping existing playback:', e);
      }
      this.sourceNode = null;
    }

    // Clear audio context to force a fresh start
    if (this.audioContext) {
      await this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    // Clear TTS client to force a fresh start
    if (this.ttsClient) {
      this.ttsClient.close();
      this.ttsClient = null;
    }

    // Clear any pending audio and streams
    this.audioChunks = [];
    if (this.currentStream) {
      try {
        if (typeof this.currentStream.removeListener === 'function') {
          ['data', 'end', 'error'].forEach(event => {
            try {
              // @ts-ignore - Safe event removal
              this.currentStream.removeListener(event);
            } catch (e) {
              console.error(`Error removing ${event} listener:`, e);
            }
          });
        }
      } catch (e) {
        console.error('Error cleaning up stream:', e);
      }
      this.currentStream = null;
    }

    // Set up new state
    this.currentSentenceIndex = index;
    this.isPlaying = true;
    this.isPaused = false;

    // Get current settings if not available
    if (!this.currentVoice || !this.currentSpeed) {
      const settings = await this.getSettings();
      this.currentVoice = settings.voice;
      this.currentSpeed = settings.speed;
    }

    console.log('Starting to read from sentence:', this.sentences[index].text);

    try {
      // Create new audio context
      this.audioContext = new AudioContext();
      await this.audioContext.resume();

      // Create new TTS client
      this.ttsClient = new EdgeTTSClient();

      // Start reading from the new index
      await this.readNextSentence(this.currentVoice, this.currentSpeed);
    } catch (error) {
      console.error('Failed to start reading from index:', error);
      this.stopReading(false, false);
      throw error;
    }
  }

  private stopReading(closeReader: boolean = false, keepState: boolean = false) {
    console.log('Stopping playback, keepState:', keepState);
    this.isPaused = false;
    this.isPlaying = false;

    // Only clear these if we're not keeping state
    if (!keepState) {
      this.currentVoice = null;
      this.currentSpeed = null;
      this.currentSentenceIndex = 0;
      this.sentences = [];
    }

    // Stop and cleanup current audio
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        console.error('Error stopping audio:', e);
      }
      this.sourceNode = null;
    }

    // Clear audio context
    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    // Clear TTS client
    if (this.ttsClient) {
      this.ttsClient.close();
      this.ttsClient = null;
    }

    // Clear any pending audio
    this.audioChunks = [];

    // Clear current stream - safely remove listeners
    if (this.currentStream) {
      try {
        if (typeof this.currentStream.removeListener === 'function') {
          ['data', 'end', 'error'].forEach(event => {
            try {
              // @ts-ignore - Safe event removal
              this.currentStream.removeListener(event);
            } catch (e) {
              console.error(`Error removing ${event} listener:`, e);
            }
          });
        }
      } catch (e) {
        console.error('Error cleaning up stream:', e);
      }
      this.currentStream = null;
    }

    // Only notify if we're actually stopping (not just for readFromIndex)
    if (!keepState) {
      // Notify the background script that reading has stopped
      chrome.runtime.sendMessage({
        action: 'readingStopped',
        closeReader: closeReader
      }).catch(console.error);
    }
  }
}

new ContentManager();
