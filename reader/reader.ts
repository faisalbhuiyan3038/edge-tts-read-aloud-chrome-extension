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
  private currentHighlight: HTMLElement | null = null;

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
          case 'highlightSentence':
            this.highlightSentence(message.index);
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
      chrome.runtime.sendMessage({ action: 'stopReading' });
      this.disableControls();
    });
  }

  private updateContent(content: string, title?: string, metadata?: ReaderMetadata) {
    // Update title
    this.title.textContent = title || 'Reader View';

    // Update metadata
    if (metadata) {
      let metadataHtml = '';
      if (metadata.author) {
        metadataHtml += `<span class="author">By ${metadata.author}</span>`;
      }
      if (metadata.siteName) {
        metadataHtml += metadataHtml ? ' • ' : '';
        metadataHtml += `<span class="site-name">${metadata.siteName}</span>`;
      }
      if (metadata.excerpt) {
        metadataHtml += `<p class="excerpt">${metadata.excerpt}</p>`;
      }
      this.metadata.innerHTML = metadataHtml;
    }

    // Update content
    this.content.innerHTML = content;

    // Reset error message
    this.hideError();

    // Enable controls after content is loaded
    this.enableControls();
  }

  private highlightSentence(index: number) {
    // Remove previous highlight
    if (this.currentHighlight) {
      this.currentHighlight.classList.remove('highlight');
    }

    // Find and highlight the new sentence
    const sentences = Array.from(this.content.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) as HTMLElement[];
    const sentence = sentences[index];
    if (sentence) {
      sentence.classList.add('highlight');
      this.currentHighlight = sentence;

      // Scroll the sentence into view
      sentence.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
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
