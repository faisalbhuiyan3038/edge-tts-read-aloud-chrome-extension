// Add type declaration at the top of the file
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

import browser from 'webextension-polyfill';
import { EdgeTTSClient, ProsodyOptions, OUTPUT_FORMAT } from 'edge-tts-client';
import { Readability } from '@mozilla/readability';
import { EventEmitter } from 'events';
import { TextProcessor, Sentence } from '../shared/text-processor';

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
    console.log('Content script initializing...');
    this.setupMessageListener();
    console.log('Content script initialized');
  }

  private setupMessageListener() {
    browser.runtime.onMessage.addListener((message, sender) => {
      console.log('Content script received message:', message, 'from:', sender);

      try {
        switch (message.action) {
          case 'startReading':
            console.log('Starting reading with:', {
              voice: message.voice,
              speed: message.speed
            });
            if (message.startFromIndex !== undefined) {
              // Start reading from specific index
              return this.readFromIndex(message.startFromIndex)
                .then(() => ({ status: 'success' }))
                .catch(error => {
                  console.error('Failed to read from index:', error);
                  return {
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                  };
                });
            } else {
              // Start reading from beginning
              return this.startReading(message.voice, message.speed)
                .then(() => ({ status: 'success' }))
                .catch(error => {
                  console.error('Failed to start reading:', error);
                  return {
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                  };
                });
            }

          case 'readFromIndex':
            if (typeof message.index === 'number') {
              return this.readFromIndex(message.index)
                .then(() => ({ status: 'success' }))
                .catch(error => ({
                  status: 'error',
                  error: error instanceof Error ? error.message : String(error)
                }));
            } else {
              console.error('Invalid index type:', message.index);
              return Promise.resolve({ status: 'error', error: 'Invalid index type' });
            }

          case 'readSelection':
            const selection = window.getSelection()?.toString().trim();
            if (selection) {
              return this.startReadingText(selection, undefined, undefined)
                .then(() => ({ status: 'success' }))
                .catch(error => ({
                  status: 'error',
                  error: error instanceof Error ? error.message : String(error)
                }));
            } else {
              return Promise.resolve({ status: 'error', error: 'No text selected' });
            }

          case 'stopReading':
            try {
              this.stopReading(message.closeReader);
              this.currentSentenceIndex = 0; // Reset to beginning
              return Promise.resolve({ status: 'success' });
            } catch (error) {
              console.error('Stop reading error:', error);
              return Promise.resolve({ status: 'error', error: 'Failed to stop reading' });
            }

          case 'pauseReading':
            try {
              this.pauseReading();
              return Promise.resolve({ status: 'success' });
            } catch (error) {
              console.error('Pause reading error:', error);
              return Promise.resolve({ status: 'error', error: 'Failed to pause reading' });
            }

          case 'resumeReading':
            return this.resumeReading()
              .then(() => ({ status: 'success' }))
              .catch(error => ({
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
              }));
        }

        return Promise.resolve({ status: 'error', error: 'Unknown action' });
      } catch (error) {
        console.error('Message handling error:', error);
        return Promise.resolve({
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to process message'
        });
      }
    });
  }

  private async startReading(voice?: string, speed?: number) {
    try {
      console.log('=== Start Reading Debug ===');
      console.log('Starting reading with voice:', voice, 'speed:', speed);

      // Stop any existing reading
      this.stopReading();

      // Get settings if not provided
      if (!voice || !speed) {
        const settings = await this.getSettings();
        console.log('Retrieved settings:', settings);
        voice = voice || settings.voice;
        speed = speed || settings.speed;
      }

      const article = this.parsePageContent();
      if (!article) {
        throw new Error('Could not parse page content');
      }

      // Initialize sentences array from the article content
      const textContent = TextProcessor.extractTextContent(article.content);
      this.sentences = TextProcessor.splitIntoSentences(textContent);
      console.log('Initialized sentences array:', this.sentences.length);

      // Format the content for the reader, using the same sentences array
      const formattedContent = this.formatArticleContent(article, this.sentences);

      console.log('Opening reader tab with content');
      // Open reader tab with the parsed text and wait for it to be ready
      const response = await browser.runtime.sendMessage({
        action: 'openReader',
        text: formattedContent,
        title: article.title,
        metadata: {
          author: article.byline,
          siteName: article.siteName,
          excerpt: article.excerpt
        }
      });

      console.log('Reader tab response:', response);
      if (response?.status === 'error') {
        throw new Error(response.error);
      }

      // Wait for the reader tab to fully initialize
      console.log('Waiting for reader tab initialization');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start reading the text
      console.log('Starting text-to-speech');
      try {
        await this.startReadingText(textContent, voice, speed);
      } catch (error) {
        console.error('Failed to start reading text:', error);
        // Send error to reader tab
        await browser.runtime.sendMessage({
          action: 'error',
          error: error instanceof Error ? error.message : 'Failed to start text-to-speech'
        });
        throw error;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Failed to start reading:', errorMessage);
      // Try to notify the reader tab about the error
      try {
        await browser.runtime.sendMessage({
          action: 'error',
          error: errorMessage
        });
      } catch (e) {
        console.error('Failed to send error to reader tab:', e);
      }
      throw new Error(errorMessage);
    }
  }

  private parsePageContent(): ParsedArticle | null {
    try {
      const documentClone = document.cloneNode(true) as Document;
      const reader = new Readability(documentClone, {
        keepClasses: true,
        classesToPreserve: ['chapter', 'article', 'section', 'title']
      });

      const article = reader.parse();

      if (article && article.content) {
        const textContent = TextProcessor.extractTextContent(article.content);
        return {
          ...article,
          textContent
        };
      }

      return article;
    } catch (error) {
      console.error('Error parsing page content:', error);
      return null;
    }
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
    content += '<div class="reader-text">\n';

    // Create sentence spans directly from our sentences array
    sentences.forEach((sentence, index) => {
      content += `<span data-sentence-index="${index}">${sentence.text} </span>`;
    });

    content += '</div>\n';

    return content;
  }

  private async startReadingText(content: string | HTMLElement, voice?: string, speed?: number) {
    try {
      console.log('=== Start Reading Text Debug ===');
      console.log('Starting to read text:', {
        contentType: typeof content === 'string' ? 'string' : 'HTMLElement',
        voice,
        speed
      });

      // Get settings if not provided
      if (!voice || !speed) {
        const settings = await this.getSettings();
        console.log('Retrieved settings:', settings);
        this.currentVoice = voice || settings.voice;
        this.currentSpeed = speed || settings.speed;
      } else {
        this.currentVoice = voice;
        this.currentSpeed = speed;
      }

      // Extract text content using shared processor
      const textContent = TextProcessor.extractTextContent(content);
      console.log('Extracted text content length:', textContent.length);

      // Initialize sentences array using shared processor
      this.sentences = TextProcessor.splitIntoSentences(textContent);
      console.log('Split text into sentences:', this.sentences.length);

      this.currentSentenceIndex = 0;
      this.isPaused = false;
      this.isPlaying = true;

      // Start reading sentences
      console.log('Starting to read sentences with:', {
        voice: this.currentVoice,
        speed: this.currentSpeed
      });
      await this.readNextSentence(this.currentVoice, this.currentSpeed);
    } catch (error) {
      console.error('TTS Error:', error);
      this.isPlaying = false;
      throw error;
    }
  }

  private async readFromIndex(index: number) {
    console.log('=== Read From Index Debug ===');
    console.log('Requested index:', index);

    if (this.sentences.length === 0) {
      console.error('No sentences available to read from');
      throw new Error('No sentences available to read from');
    }

    if (index >= this.sentences.length) {
      console.error('Index out of bounds:', index, 'Total sentences:', this.sentences.length);
      throw new Error('Index out of bounds');
    }

    // First, stop any current reading completely
    await this.stopCurrentReading();

    try {
      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      await this.audioContext.resume();

      // Initialize TTS client if needed
      if (!this.ttsClient) {
        this.ttsClient = new EdgeTTSClient();
      }

      // Get current settings if not available
      if (!this.currentVoice || !this.currentSpeed) {
        const settings = await this.getSettings();
        this.currentVoice = settings.voice;
        this.currentSpeed = settings.speed;
      }

      // Update state
      this.currentSentenceIndex = index;
      this.isPlaying = true;
      this.isPaused = false;

      console.log('Starting to read from sentence:', {
        index: this.currentSentenceIndex,
        text: this.sentences[this.currentSentenceIndex].text
      });

      // Start reading from the new index
      await this.readNextSentence(this.currentVoice, this.currentSpeed);
    } catch (error) {
      console.error('Failed to start reading from index:', error);
      await this.stopCurrentReading();
      throw error;
    }
  }

  private async stopCurrentReading(): Promise<void> {
    console.log('Stopping current reading...');

    // Stop any current audio playback
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        console.error('Error stopping current audio:', e);
      }
      this.sourceNode = null;
    }

    // Clear current stream
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

    // Clear audio context
    if (this.audioContext) {
      try {
        await this.audioContext.close();
        this.audioContext = null;
      } catch (e) {
        console.error('Error closing audio context:', e);
      }
    }

    // Clear TTS client
    if (this.ttsClient) {
      this.ttsClient.close();
      this.ttsClient = null;
    }

    // Clear any pending audio
    this.audioChunks = [];

    // Reset state
    this.isPlaying = false;
    this.isPaused = false;

    // Wait a small amount of time to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private async readNextSentence(voice: string, speed: number) {
    console.log('=== Read Next Sentence Debug ===');
    console.log('State:', {
      isPaused: this.isPaused,
      isPlaying: this.isPlaying,
      currentIndex: this.currentSentenceIndex,
      totalSentences: this.sentences.length
    });

    if (this.isPaused || !this.isPlaying || this.currentSentenceIndex >= this.sentences.length) {
      console.log('ReadNextSentence early return:', {
        isPaused: this.isPaused,
        isPlaying: this.isPlaying,
        currentIndex: this.currentSentenceIndex,
        totalSentences: this.sentences.length
      });
      if (this.currentSentenceIndex >= this.sentences.length) {
        this.stopReading(true);
      }
      return;
    }

    const sentence = this.sentences[this.currentSentenceIndex];
    console.log('Reading sentence:', {
      index: this.currentSentenceIndex,
      text: sentence.text.substring(0, 50) + '...',
      isHeading: sentence.isHeading
    });

    try {
      // Notify the reader about the current sentence
      await browser.runtime.sendMessage({
        action: 'updateReaderHighlight',
        index: this.currentSentenceIndex,
        text: sentence.text
      });

      console.log('Starting sentence audio playback');
      // Read the sentence and wait for it to complete
      await this.readSentence(sentence.text, voice, speed);
      console.log('Sentence audio playback completed');

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
        console.log('=== Read Sentence Debug ===');
        if (!this.ttsClient) {
          console.log('Creating new TTS client');
          this.ttsClient = new EdgeTTSClient();
        }

        // Initialize audio context if needed
        if (!this.audioContext) {
          console.log('Creating new AudioContext');
          try {
            // Try to create audio context with user gesture
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
              // Firefox requires these options for better compatibility
              latencyHint: 'interactive',
              sampleRate: 48000
            });
            console.log('AudioContext created successfully:', this.audioContext.state);

            // Ensure we have user interaction
            if (this.audioContext.state === 'suspended') {
              console.log('Audio context suspended, attempting to resume...');
              await this.audioContext.resume();
              console.log('AudioContext state after resume:', this.audioContext.state);
            }
          } catch (error) {
            console.error('Failed to create AudioContext:', error);
            throw new Error('Failed to initialize audio. Please ensure audio is enabled in your browser.');
          }
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

        // Collect all chunks before playing
        const allChunks: Uint8Array[] = [];

        console.log('Starting TTS stream for text:', text);
        const stream = this.ttsClient.toStream(text, options) as unknown as TTSStream;
        this.currentStream = stream;

        if (!stream || typeof stream.on !== 'function') {
          throw new Error('Invalid stream object');
        }

        // Set up event handlers
        stream.on('data', (chunk: Uint8Array) => {
          console.log('Received audio chunk:', {
            chunkSize: chunk.length,
            totalChunks: allChunks.length + 1
          });
          allChunks.push(chunk);
        });

        stream.on('error', (error: Error) => {
          console.error('Stream error:', error);
          cleanup();
          reject(error);
        });

        stream.on('end', async () => {
          console.log('=== Stream End Debug ===');
          console.log('Stream ended, total chunks:', allChunks.length);

          if (this.isPaused) {
            console.log('Playback paused, cleaning up');
            cleanup();
            currentSentenceResolver();
            return;
          }

          if (allChunks.length === 0) {
            console.error('Stream ended without receiving any data');
            reject(new Error('No audio data received'));
            return;
          }

          try {
            // Combine all chunks into one buffer
            const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.length, 0);
            console.log('Creating combined buffer of size:', totalLength);
            const combinedBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of allChunks) {
              combinedBuffer.set(chunk, offset);
              offset += chunk.length;
            }

            if (this.isPaused) {
              cleanup();
              currentSentenceResolver();
              return;
            }

            console.log('Decoding audio data');
            // Create audio buffer
            const audioBuffer = await audioContext.decodeAudioData(combinedBuffer.buffer);
            console.log('Audio buffer created:', {
              duration: audioBuffer.duration,
              numberOfChannels: audioBuffer.numberOfChannels,
              sampleRate: audioBuffer.sampleRate
            });

            if (this.isPaused) {
              cleanup();
              currentSentenceResolver();
              return;
            }

            // Create and connect source node
            console.log('Creating and connecting source node');
            const sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(audioContext.destination);

            // Store the source node
            this.sourceNode = sourceNode;

            // When audio ends, resolve the promise
            sourceNode.onended = () => {
              console.log('Audio playback ended');
              this.sourceNode = null;
              currentSentenceResolver();
            };

            // Start playing
            console.log('Starting audio playback');
            sourceNode.start();

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
    const response = await browser.runtime.sendMessage({ action: 'getSettings' });
    return response || { voice: 'en-US-AvaNeural', speed: 1.0 };
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
      browser.runtime.sendMessage({
        action: 'readingStopped',
        closeReader: closeReader
      }).catch(console.error);
    }
  }
}

new ContentManager();
