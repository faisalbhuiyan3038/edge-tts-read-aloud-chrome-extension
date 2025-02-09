import browser from 'webextension-polyfill';
import { TextProcessor } from '../shared/text-processor';

interface ReaderMetadata {
  author?: string;
  siteName?: string;
  excerpt?: string;
}

class ReaderManager {
  private title: HTMLHeadingElement;
  private metadata: HTMLDivElement;
  private content: HTMLDivElement;
  private errorMessage: HTMLDivElement;
  private pauseButton: HTMLButtonElement;
  private resumeButton: HTMLButtonElement;
  private stopButton: HTMLButtonElement;

  constructor() {
    // Initialize elements
    this.title = document.querySelector('.reader-title') as HTMLHeadingElement;
    this.metadata = document.querySelector('.reader-metadata') as HTMLDivElement;
    this.content = document.querySelector('.reader-content') as HTMLDivElement;
    this.errorMessage = document.querySelector('.error-message') as HTMLDivElement;
    this.pauseButton = document.getElementById('pauseButton') as HTMLButtonElement;
    this.resumeButton = document.getElementById('resumeButton') as HTMLButtonElement;
    this.stopButton = document.getElementById('stopButton') as HTMLButtonElement;

    this.setupMessageListener();
    this.setupControlButtons();
    this.setupClickToRead();
  }

  private setupClickToRead() {
    // Add click handler style
    if (!document.querySelector('#sentence-styles')) {
      const style = document.createElement('style');
      style.id = 'sentence-styles';
      style.textContent = `
        [data-sentence-index] {
          cursor: pointer;
          position: relative;
          padding-left: 2px;
          padding-right: 2px;
          border-radius: 2px;
        }
        [data-sentence-index]:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }
        [data-sentence-index].active {
          background-color: rgba(0, 120, 255, 0.1);
        }
        [data-sentence-index].active::before {
          content: '▶';
          position: absolute;
          left: -15px;
          color: rgba(0, 120, 255, 0.8);
          font-size: 10px;
        }
      `;
      document.head.appendChild(style);
    }

    // Add click handler for sentences
    this.content.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;
      const sentence = target.closest('[data-sentence-index]');
      if (sentence) {
        const index = parseInt(sentence.getAttribute('data-sentence-index') || '-1', 10);
        if (index >= 0) {
          console.log('=== Click To Read Debug ===');
          console.log('Clicked element:', sentence.outerHTML);
          console.log('Clicked index:', index);
          console.log('Clicked text:', sentence.textContent);

          try {
            // Update visual state first
            this.updateActiveSentence(index);

            // Send message to background script to update reading position
            console.log('Sending readFromIndex message:', index);
            const response = await browser.runtime.sendMessage({
              action: 'readFromIndex',
              index: index
            });

            console.log('Received response:', response);

            if (response?.status === 'error') {
              throw new Error(response.error || 'Failed to start reading');
            }

            // Enable controls only after successful response
            this.enableControls();
          } catch (error) {
            console.error('Failed to start reading from index:', error);
            this.showError('Failed to start reading from selected sentence');
            this.clearActiveSentence();
          }
        }
      }
    });
  }

  private updateActiveSentence(index: number) {
    // Remove active class from all sentences
    this.clearActiveSentence();

    // Add active class to new sentence
    const newActiveSentence = this.content.querySelector(`[data-sentence-index="${index}"]`);
    if (newActiveSentence) {
      newActiveSentence.classList.add('active');

      // Scroll sentence into view if not visible
      newActiveSentence.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  }

  private clearActiveSentence() {
    this.content.querySelectorAll('[data-sentence-index].active').forEach(el => {
      el.classList.remove('active');
    });
  }

  // Update the highlightSentence method to use our new active sentence system
  public highlightSentence(index: number) {
    this.updateActiveSentence(index);
  }

  private setupMessageListener() {
    browser.runtime.onMessage.addListener((message, sender) => {
      console.log('Reader received message:', message);

      try {
        switch (message.action) {
          case 'ping':
            console.log('Received ping, responding with pong');
            return Promise.resolve({ status: 'pong' });

          case 'updateContent':
            this.updateContent(message.content, message.title, message.metadata);
            return Promise.resolve({ status: 'success' });

          case 'readingStarted':
            this.enableControls();
            return Promise.resolve({ status: 'success' });

          case 'readingStopped':
            this.disableControls();
            return Promise.resolve({ status: 'success' });

          case 'error':
            this.showError(message.error);
            return Promise.resolve({ status: 'success' });

          default:
            return Promise.resolve({ status: 'error', error: 'Unknown action' });
        }
      } catch (error) {
        console.error('Error handling message:', error);
        return Promise.resolve({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });
  }

  private setupControlButtons() {
    this.pauseButton.addEventListener('click', () => {
      browser.runtime.sendMessage({ action: 'pauseReading' });
      this.pauseButton.disabled = true;
      this.resumeButton.disabled = false;
    });

    this.resumeButton.addEventListener('click', () => {
      browser.runtime.sendMessage({ action: 'resumeReading' });
      this.resumeButton.disabled = true;
      this.pauseButton.disabled = false;
    });

    this.stopButton.addEventListener('click', () => {
      browser.runtime.sendMessage({
        action: 'stopReading',
        closeReader: true
      });
      this.disableControls();
    });
  }

  private updateContent(content: string, title?: string, metadata?: ReaderMetadata) {
    console.log('=== Update Content Debug ===');
    // Update title
    this.title.textContent = title || 'Reader View';

    // Update metadata
    let metadataHtml = '';
    if (metadata) {
      if (metadata.author) {
        metadataHtml += `<p class="author">By ${metadata.author}</p>`;
      }
      if (metadata.siteName) {
        metadataHtml += `<p class="site-name">From ${metadata.siteName}</p>`;
      }
      if (metadata.excerpt) {
        metadataHtml += `<p class="excerpt">${metadata.excerpt}</p>`;
      }
    }
    this.metadata.innerHTML = metadataHtml;

    // First, set the content to preserve HTML structure
    this.content.innerHTML = content;

    // Process text nodes while preserving HTML structure
    let sentenceIndex = 0;
    const textNodes = [];
    const walk = document.createTreeWalker(
      this.content,
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
      textNodes.push(node);
    }

    console.log('Found text nodes:', textNodes.length);

    // Process each text node
    textNodes.forEach((textNode) => {
      const text = textNode.textContent || '';
      if (!text.trim()) return;

      // Get sentences from this text node
      const sentences = TextProcessor.splitIntoSentences(text);
      if (sentences.length === 0) return;

      // Create a document fragment to hold the sentence spans
      const fragment = document.createDocumentFragment();
      sentences.forEach((sentence) => {
        const span = document.createElement('span');
        span.setAttribute('data-sentence-index', sentenceIndex.toString());
        span.textContent = sentence.text + ' ';
        fragment.appendChild(span);
        console.log(`Created span for sentence ${sentenceIndex}:`, {
          text: sentence.text.substring(0, 50) + (sentence.text.length > 50 ? '...' : ''),
          parentTag: textNode.parentElement?.tagName
        });
        sentenceIndex++;
      });

      // Replace the text node with our sentence spans
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });

    console.log('Total sentences created:', sentenceIndex);

    // Hide error message
    this.hideError();

    // Enable controls
    this.enableControls();
  }

  private enableControls() {
    this.pauseButton.disabled = false;
    this.stopButton.disabled = false;
    this.resumeButton.disabled = true;
  }

  private disableControls() {
    this.pauseButton.disabled = true;
    this.resumeButton.disabled = true;
    this.stopButton.disabled = true;
  }

  private showError(message: string) {
    this.errorMessage.textContent = message;
    this.errorMessage.style.display = 'block';
    setTimeout(() => this.hideError(), 5000);
  }

  private hideError() {
    this.errorMessage.style.display = 'none';
    this.errorMessage.textContent = '';
  }
}

// Initialize the reader manager
new ReaderManager();
