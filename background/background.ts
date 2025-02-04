class BackgroundManager {
  private readerTabId: number | null = null;

  constructor() {
    this.setupMessageListener();
    this.setupContextMenu();
    console.log('Background script initialized');
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Background received message:', message);

      try {
        switch (message.action) {
          case 'openReader':
            this.openReaderTab(message.text, message.title, message.metadata)
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
            break;

          case 'readSelection':
            this.sendMessageToActiveTab({ action: 'readSelection' })
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
            break;

          case 'stopReading':
            this.sendMessageToActiveTab({ action: 'stopReading' })
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
            break;

          case 'pauseReading':
            this.sendMessageToActiveTab({ action: 'pauseReading' })
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
            break;

          case 'resumeReading':
            this.sendMessageToActiveTab({ action: 'resumeReading' })
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
            break;

          case 'getSettings':
            chrome.storage.sync.get({
              voice: 'en-US-AvaNeural',
              speed: 1.0
            }, (settings) => {
              console.log('Sending settings:', settings);
              sendResponse(settings);
            });
            break;

          case 'updateReaderHighlight':
            if (this.readerTabId) {
              this.sendMessageToTab(this.readerTabId, {
                action: 'highlightSentence',
                index: message.index,
                text: message.text
              }).then(() => sendResponse({ status: 'success' }))
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            } else {
              sendResponse({ status: 'error', error: 'Reader tab not found' });
            }
            break;

          default:
            sendResponse({ status: 'error', error: 'Unknown action' });
            return false;
        }

        return true; // Keep the message channel open for async response
      } catch (error) {
        console.error('Error handling message:', error);
        sendResponse({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        return false;
      }
    });
  }

  private setupContextMenu() {
    chrome.contextMenus.create({
      id: 'readSelection',
      title: 'Read Selection',
      contexts: ['selection']
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === 'readSelection' && tab?.id) {
        console.log('Context menu: Read selection clicked');
        this.sendMessageToTab(tab.id, { action: 'readSelection' })
          .catch(error => console.error('Failed to send readSelection message:', error));
      }
    });
  }

  private async openReaderTab(content: string, title?: string, metadata?: any) {
    try {
      // Check if reader tab exists and is still open
      if (this.readerTabId !== null) {
        try {
          const tab = await chrome.tabs.get(this.readerTabId);
          if (tab) {
            console.log('Updating existing reader tab');
            await chrome.tabs.update(this.readerTabId, { active: true });
            await this.updateReaderContent(this.readerTabId, content, title, metadata);
            return;
          }
        } catch (error) {
          console.log('Previous reader tab no longer exists');
          this.readerTabId = null;
        }
      }

      // Create new reader tab
      console.log('Creating new reader tab');
      const tab = await chrome.tabs.create({
        url: chrome.runtime.getURL('reader/reader.html'),
        active: true
      });

      if (tab.id) {
        this.readerTabId = tab.id;
        // Wait for the tab to load before sending content
        await new Promise<void>((resolve, reject) => {
          const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              // Wait a bit for the reader script to initialize
              setTimeout(async () => {
                try {
                  await this.updateReaderContent(tabId, content, title, metadata);
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }, 100);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    } catch (error) {
      console.error('Failed to open reader tab:', error);
      throw error;
    }
  }

  private async updateReaderContent(tabId: number, content: string, title?: string, metadata?: any) {
    try {
      await this.sendMessageToTab(tabId, {
        action: 'updateContent',
        content,
        title,
        metadata
      });
    } catch (error) {
      console.error('Failed to update reader content:', error);
      throw error;
    }
  }

  private async sendMessageToTab(tabId: number, message: any): Promise<any> {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      console.error(`Failed to send message to tab ${tabId}:`, error);
      throw error;
    }
  }

  private async sendMessageToActiveTab(message: any) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        console.log('Sending message to active tab:', message);
        return await this.sendMessageToTab(tab.id, message);
      } else {
        throw new Error('No active tab found');
      }
    } catch (error) {
      console.error('Failed to send message to active tab:', error);
      throw error;
    }
  }
}

new BackgroundManager();
