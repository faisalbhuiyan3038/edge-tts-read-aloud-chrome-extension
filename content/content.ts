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
  on(event: 'data', listener: (chunk: Uint8Array) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
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

      switch (message.action) {
        case 'startReading':
          this.startReading(message.voice, message.speed)
            .then(() => sendResponse({ status: 'success' }))
            .catch(error => {
              console.error('Start reading error:', error);
              sendResponse({ status: 'error', error: error instanceof Error ? error.message : String(error) });
            });
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
          this.stopReading();
          sendResponse({ status: 'success' });
          break;

        case 'pauseReading':
          this.pauseReading();
          sendResponse({ status: 'success' });
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

      // Format the content for the reader
      const formattedContent = this.formatArticleContent(article);

      // Open reader tab with the parsed text
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

      // Start reading the text
      await this.startReadingText(article.textContent, voice, speed);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Failed to start reading:', errorMessage);
      // Notify the reader about the error
      chrome.runtime.sendMessage({
        action: 'updateReaderContent',
        error: errorMessage
      });
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

  private formatArticleContent(article: ParsedArticle): string {
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

    // Add main content
    content += article.content;

    return content;
  }

  private async startReadingText(text: string, voice?: string, speed?: number) {
    try {
      // Get settings if not provided
      if (!voice || !speed) {
        const settings = await this.getSettings();
        voice = voice || settings.voice;
        speed = speed || settings.speed;
      }

      // Split text into sentences
      this.sentences = this.splitIntoSentences(text);
      this.currentSentenceIndex = 0;
      this.isPaused = false;

      // Start reading sentences
      await this.readNextSentence(voice, speed);
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
    if (this.isPaused || this.currentSentenceIndex >= this.sentences.length) {
      if (this.currentSentenceIndex >= this.sentences.length) {
        this.stopReading();
      }
      return;
    }

    const sentence = this.sentences[this.currentSentenceIndex];

    try {
      // Update reader highlight
      await chrome.runtime.sendMessage({
        action: 'updateReaderHighlight',
        index: this.currentSentenceIndex,
        text: sentence.text
      });

      // Read the sentence
      await this.readSentence(sentence.text, voice, speed);

      // Move to next sentence
      this.currentSentenceIndex++;
      await this.readNextSentence(voice, speed);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Error reading sentence:', errorMessage);
      this.stopReading();
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

        console.log('Setting TTS metadata:', { voice, format: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3 });
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
        const stream = this.ttsClient.toStream(text, options);
        console.log('Stream created:', stream);

        if (!stream || typeof stream.on !== 'function') {
          throw new Error('Invalid stream object');
        }

        // Set up event handlers
        stream.on('data', (chunk: Uint8Array) => {
          console.log('Received audio chunk:', chunk.length, 'bytes');
          allChunks.push(chunk);
        });

        stream.on('end', async () => {
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
              console.log('Playback paused, skipping audio');
              resolve();
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
              resolve();
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
    console.log('Resuming playback');
    this.isPaused = false;
    const settings = await this.getSettings();
    await this.readNextSentence(settings.voice, settings.speed);
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
        // Ignore errors if already stopped
      }
      this.sourceNode = null;
    }

    // Clear any pending audio
    this.audioChunks = [];
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

  private stopReading() {
    console.log('Stopping playback');
    this.isPaused = false;
    this.currentSentenceIndex = 0;
    this.isPlaying = false;

    // Stop current audio
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // Ignore errors if already stopped
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

    // Notify the reader that reading has stopped
    chrome.runtime.sendMessage({ action: 'readingStopped' }).catch(console.error);
  }
}

new ContentManager();
