class BackgroundManager {
  private readerTabId: number | null = null;
  private sourceTabId: number | null = null;

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
          case 'setSourceTab':
            this.sourceTabId = message.tabId;
            sendResponse({ status: 'success' });
            break;

          case 'openReader':
            // Store the sender tab as the source tab
            if (sender.tab?.id) {
              this.sourceTabId = sender.tab.id;
            }
            this.openReaderTab(message.text, message.title, message.metadata)
              .then(() => sendResponse({ status: 'success' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
            break;

          case 'readSelection':
            if (this.sourceTabId) {
              this.sendMessageToTab(this.sourceTabId, { action: 'readSelection' })
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            }
            break;

          case 'stopReading':
            if (this.sourceTabId) {
              this.sendMessageToTab(this.sourceTabId, {
                action: 'stopReading',
                closeReader: true
              })
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            }
            break;

          case 'pauseReading':
            if (this.sourceTabId) {
              this.sendMessageToTab(this.sourceTabId, { action: 'pauseReading' })
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            }
            break;

          case 'resumeReading':
            if (this.sourceTabId) {
              this.sendMessageToTab(this.sourceTabId, { action: 'resumeReading' })
                .then(() => sendResponse({ status: 'success' }))
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            }
            break;

          case 'readingStopped':
            // Only close the reader tab if it's a full stop (not readFromIndex)
            if (message.closeReader) {
              if (this.readerTabId) {
                chrome.tabs.remove(this.readerTabId).catch(console.error);
                this.readerTabId = null;
              }
              this.sourceTabId = null;
            }
            sendResponse({ status: 'success' });
            break;

          case 'updateReaderHighlight':
            if (this.readerTabId) {
              this.sendMessageToTab(this.readerTabId, {
                action: 'highlightSentence',
                index: message.index,
                text: message.text
              }).then(() => sendResponse({ status: 'success' }))
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            }
            break;

          case 'getSettings':
            chrome.storage.sync.get({
              voice: 'Microsoft Server Speech Text to Speech Voice (en-US, AvaNeural)',
              speed: 1.0
            }, (settings) => {
              console.log('Sending settings:', settings);
              sendResponse(settings);
            });
            break;

          case 'readFromIndex':
            if (this.sourceTabId) {
              // First stop current reading without closing reader
              this.sendMessageToTab(this.sourceTabId, {
                action: 'stopReading',
                closeReader: false
              })
                .then(() => {
                  // Wait a bit for cleanup
                  setTimeout(async () => {
                    try {
                      if (this.sourceTabId) {
                        console.log('Sending readFromIndex to source tab:', message.index);
                        // Send readFromIndex to source tab
                        await this.sendMessageToTab(this.sourceTabId, {
                          action: 'readFromIndex',
                          index: message.index
                        });

                        // Enable controls in reader tab
                        if (this.readerTabId) {
                          await this.sendMessageToTab(this.readerTabId, {
                            action: 'readingStarted'
                          });
                        }
                        sendResponse({ status: 'success' });
                      }
                    } catch (error) {
                      console.error('Error in readFromIndex:', error);
                      // Notify reader tab of error
                      if (this.readerTabId) {
                        await this.sendMessageToTab(this.readerTabId, {
                          action: 'error',
                          error: error instanceof Error ? error.message : 'Failed to start reading'
                        });
                      }
                      sendResponse({ status: 'error', error: error instanceof Error ? error.message : 'Failed to start reading' });
                    }
                  }, 100);
                })
                .catch(error => {
                  console.error('Error stopping current reading:', error);
                  sendResponse({ status: 'error', error: error.message });
                });
              return true; // Keep message channel open
            }
            sendResponse({ status: 'error', error: 'No source tab found' });
            return false;

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
    // Remove existing menu items first
    chrome.contextMenus.removeAll(() => {
      // Create new menu item
      chrome.contextMenus.create({
        id: 'readSelection',
        title: 'Read Selection',
        contexts: ['selection']
      });
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

      if (!tab.id) {
        throw new Error('Failed to create reader tab');
      }

      this.readerTabId = tab.id;

      // Wait for the tab to load before sending content
      await new Promise<void>((resolve, reject) => {
        let retries = 0;
        const maxRetries = 20; // Increased retries
        const retryInterval = 200; // Increased interval

        const tryUpdateContent = async () => {
          try {
            await this.updateReaderContent(tab.id!, content, title, metadata);
            resolve();
          } catch (error) {
            console.log(`Retry ${retries + 1}/${maxRetries} failed:`, error);
            retries++;
            if (retries >= maxRetries) {
              reject(new Error('Failed to update reader content after multiple attempts'));
              return;
            }
            // Wait for the next retry
            setTimeout(tryUpdateContent, retryInterval);
          }
        };

        const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Give the reader script more time to initialize
            setTimeout(tryUpdateContent, 500);
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });

    } catch (error) {
      console.error('Failed to open reader tab:', error);
      throw error;
    }
  }

  private async updateReaderContent(tabId: number, content: string, title?: string, metadata?: any) {
    try {
      console.log('Attempting to update reader content for tab:', tabId);

      // Try to get the tab to verify it exists
      await chrome.tabs.get(tabId);

      const response = await this.sendMessageToTab(tabId, {
        action: 'updateContent',
        content,
        title,
        metadata
      });

      if (!response) {
        throw new Error('No response received from reader tab');
      }

      if (response.status === 'error') {
        throw new Error(response.error || 'Failed to update reader content');
      }

      console.log('Reader content updated successfully');
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
