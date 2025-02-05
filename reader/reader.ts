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
        }
        [data-sentence-index]:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }
      `;
      document.head.appendChild(style);
    }

    // Add click handler for sentences
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const sentence = target.closest('[data-sentence-index]');
      if (sentence) {
        const index = parseInt(sentence.getAttribute('data-sentence-index') || '-1', 10);
        if (index >= 0) {
          console.log('Clicked sentence index:', index);
          chrome.runtime.sendMessage({
            action: 'readFromIndex',
            index: index
          }).catch(error => {
            console.error('Failed to start reading from index:', error);
            this.showError('Failed to start reading from selected sentence');
          });
        }
      }
    });
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Reader received message:', message);

      try {
        switch (message.action) {
          case 'updateContent':
            this.updateContent(message.content, message.title, message.metadata);
            sendResponse({ status: 'success' });
            break;
          case 'readingStarted':
            this.enableControls();
            sendResponse({ status: 'success' });
            break;
          case 'readingStopped':
            this.disableControls();
            sendResponse({ status: 'success' });
            break;
          case 'error':
            this.showError(message.error);
            sendResponse({ status: 'success' });
            break;
          default:
            sendResponse({ status: 'error', error: 'Unknown action' });
        }
      } catch (error) {
        console.error('Error handling message:', error);
        sendResponse({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      }

      return false; // Don't keep the message channel open
    });
  }

  private setupControlButtons() {
    this.pauseButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'pauseReading' });
      this.pauseButton.disabled = true;
      this.resumeButton.disabled = false;
    });

    this.resumeButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'resumeReading' });
      this.resumeButton.disabled = true;
      this.pauseButton.disabled = false;
    });

    this.stopButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'stopReading',
        closeReader: true
      });
      this.disableControls();
    });
  }

  private updateContent(content: string, title?: string, metadata?: ReaderMetadata) {
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

    // Now wrap text in clickable elements while preserving HTML
    let sentenceIndex = 0;
    const textNodes = [];
    const walk = document.createTreeWalker(
      this.content,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          // Skip script and style contents
          if (node.parentElement?.tagName === 'SCRIPT' ||
            node.parentElement?.tagName === 'STYLE') {
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

    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const sentences = text.split(/(?<=[.!?])\s+/);
      if (sentences.length > 0 && textNode.parentNode) {
        const fragment = document.createDocumentFragment();
        sentences.forEach(sentence => {
          if (sentence.trim()) {
            const span = document.createElement('span');
            span.setAttribute('data-sentence-index', sentenceIndex.toString());
            span.textContent = sentence + ' ';
            fragment.appendChild(span);
            sentenceIndex++;
          }
        });
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });

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
