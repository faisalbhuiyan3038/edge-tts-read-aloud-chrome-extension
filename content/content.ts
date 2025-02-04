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
            try {
              this.stopReading();
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
        this.currentVoice = voice || settings.voice;
        this.currentSpeed = speed || settings.speed;
      } else {
        this.currentVoice = voice;
        this.currentSpeed = speed;
      }

      // Split text into sentences
      this.sentences = this.splitIntoSentences(text);
      this.currentSentenceIndex = 0;
      this.isPaused = false;

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
    if (this.isPaused || this.currentSentenceIndex >= this.sentences.length) {
      if (this.currentSentenceIndex >= this.sentences.length) {
        this.stopReading();
      }
      return;
    }

    const sentence = this.sentences[this.currentSentenceIndex];

    try {
      // Update reader highlight before reading
      await chrome.runtime.sendMessage({
        action: 'updateReaderHighlight',
        index: this.currentSentenceIndex,
        text: sentence.text
      });

      // Check if we should stop before reading
      if (this.isPaused) {
        return;
      }

      // Read the sentence and wait for it to complete
      await this.readSentence(sentence.text, voice, speed);

      // Check if we should continue after the sentence is finished
      if (!this.isPaused && this.isPlaying) {
        // Move to next sentence
        this.currentSentenceIndex++;
        // Small delay to ensure proper timing between sentences
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.readNextSentence(voice, speed);
      }
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
        const stream = this.ttsClient.toStream(text, options);
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

            // Send message to reader tab that we're playing this sentence
            chrome.runtime.sendMessage({
              action: 'readingStatus',
              status: 'playing',
              sentenceIndex: this.currentSentenceIndex
            }).catch(console.error);

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

  private stopReading() {
    console.log('Stopping playback');
    this.isPaused = false;
    this.isPlaying = false;
    this.currentVoice = null;
    this.currentSpeed = null;
    this.currentSentenceIndex = 0;
    this.sentences = [];

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

    // Clear current stream
    if (this.currentStream) {
      try {
        // @ts-ignore - EventEmitter cleanup
        this.currentStream.removeAllListeners();
      } catch (e) {
        console.error('Error cleaning up stream:', e);
      }
      this.currentStream = null;
    }

    // Notify the background script that reading has stopped
    chrome.runtime.sendMessage({ action: 'readingStopped' }).catch(console.error);
  }
}

new ContentManager();
