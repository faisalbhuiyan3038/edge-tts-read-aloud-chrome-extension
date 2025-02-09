// Import Firefox WebExtension types
import browser from 'webextension-polyfill';
import type { Tabs, Runtime } from 'webextension-polyfill';

class BackgroundManager {
  private readerTabId: number | null = null;
  private sourceTabId: number | null = null;

  constructor() {
    this.setupMessageListener();
    this.setupContextMenu();
    console.log('Background script initialized');
  }

  private setupMessageListener() {
    browser.runtime.onMessage.addListener(async (message: any, sender: Runtime.MessageSender) => {
      console.log('Background received message:', message);

      try {
        switch (message.action) {
          case 'setSourceTab':
            this.sourceTabId = message.tabId;
            return { status: 'success' };

          case 'openReader':
            // Store the sender tab as the source tab
            if (sender.tab?.id) {
              this.sourceTabId = sender.tab.id;
            }
            try {
              await this.openReaderTab(message.text, message.title, message.metadata);
              return { status: 'success' };
            } catch (error) {
              return { status: 'error', error: error instanceof Error ? error.message : String(error) };
            }

          case 'readSelection':
            if (this.sourceTabId) {
              try {
                await this.sendMessageToTab(this.sourceTabId, { action: 'readSelection' });
                return { status: 'success' };
              } catch (error) {
                return { status: 'error', error: error instanceof Error ? error.message : String(error) };
              }
            }
            break;

          case 'stopReading':
            if (this.sourceTabId) {
              try {
                await this.sendMessageToTab(this.sourceTabId, {
                  action: 'stopReading',
                  closeReader: true
                });
                return { status: 'success' };
              } catch (error) {
                return { status: 'error', error: error instanceof Error ? error.message : String(error) };
              }
            }
            break;

          case 'pauseReading':
            if (this.sourceTabId) {
              try {
                await this.sendMessageToTab(this.sourceTabId, { action: 'pauseReading' });
                return { status: 'success' };
              } catch (error) {
                return { status: 'error', error: error instanceof Error ? error.message : String(error) };
              }
            }
            break;

          case 'resumeReading':
            if (this.sourceTabId) {
              try {
                await this.sendMessageToTab(this.sourceTabId, { action: 'resumeReading' });
                return { status: 'success' };
              } catch (error) {
                return { status: 'error', error: error instanceof Error ? error.message : String(error) };
              }
            }
            break;

          case 'readingStopped':
            // Only close the reader tab if it's a full stop (not readFromIndex)
            if (message.closeReader) {
              if (this.readerTabId) {
                await browser.tabs.remove(this.readerTabId);
                this.readerTabId = null;
              }
              this.sourceTabId = null;
            }
            return { status: 'success' };

          case 'updateReaderHighlight':
            if (this.readerTabId) {
              try {
                await this.sendMessageToTab(this.readerTabId, {
                  action: 'highlightSentence',
                  index: message.index,
                  text: message.text
                });
                return { status: 'success' };
              } catch (error) {
                return { status: 'error', error: error instanceof Error ? error.message : String(error) };
              }
            }
            break;

          case 'getSettings':
            try {
              const settings = await browser.storage.sync.get({
                voice: 'Microsoft Server Speech Text to Speech Voice (en-US, AvaNeural)',
                speed: 1.0
              });
              console.log('Sending settings:', settings);
              return settings;
            } catch (error) {
              console.error('Error getting settings:', error);
              return { voice: 'en-US-AvaNeural', speed: 1.0 };
            }

          case 'readFromIndex':
            if (this.sourceTabId) {
              console.log('Handling readFromIndex for index:', message.index);
              try {
                // Send readFromIndex directly to content script
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
                return { status: 'success' };
              } catch (error) {
                console.error('Error in readFromIndex:', error);
                if (this.readerTabId) {
                  await this.sendMessageToTab(this.readerTabId, {
                    action: 'error',
                    error: error instanceof Error ? error.message : 'Failed to start reading'
                  });
                }
                return { status: 'error', error: error instanceof Error ? error.message : 'Failed to start reading' };
              }
            }
            return { status: 'error', error: 'No source tab found' };

          default:
            return { status: 'error', error: 'Unknown action' };
        }
      } catch (error) {
        console.error('Error handling message:', error);
        return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }

  private setupContextMenu() {
    // Remove existing menu items first
    browser.contextMenus.removeAll();

    // Create new menu item
    browser.contextMenus.create({
      id: 'readSelection',
      title: 'Read Selection',
      contexts: ['selection']
    });

    browser.contextMenus.onClicked.addListener(async (info: browser.Menus.OnClickData, tab?: Tabs.Tab) => {
      if (info.menuItemId === 'readSelection' && tab?.id) {
        console.log('Context menu: Read selection clicked');
        try {
          await this.sendMessageToTab(tab.id, { action: 'readSelection' });
        } catch (error) {
          console.error('Failed to send readSelection message:', error);
        }
      }
    });
  }

  private async openReaderTab(content: string, title?: string, metadata?: any) {
    try {
      // Check if reader tab exists and is still open
      if (this.readerTabId !== null) {
        try {
          const tab = await browser.tabs.get(this.readerTabId);
          if (tab) {
            console.log('Updating existing reader tab');
            await browser.tabs.update(this.readerTabId, { active: true });
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
      const tab = await browser.tabs.create({
        url: browser.runtime.getURL('reader/reader.html'),
        active: true
      });

      if (!tab.id) {
        throw new Error('Failed to create reader tab');
      }

      this.readerTabId = tab.id;

      // Wait for the tab to load before sending content
      await new Promise<void>((resolve, reject) => {
        let retries = 0;
        const maxRetries = 20;
        const retryInterval = 200;

        const tryUpdateContent = async () => {
          try {
            // First, check if we can communicate with the tab
            try {
              const response = await browser.tabs.sendMessage(tab.id!, { action: 'ping' });
              if (response?.status !== 'pong') {
                throw new Error('Invalid ping response');
              }
            } catch (error) {
              console.log('Tab not ready yet, retrying...');
              throw error;
            }

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

        const listener = (tabId: number, changeInfo: Tabs.OnUpdatedChangeInfoType) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            browser.tabs.onUpdated.removeListener(listener);
            // Give the reader script more time to initialize
            setTimeout(tryUpdateContent, 500);
          }
        };

        browser.tabs.onUpdated.addListener(listener);
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
      await browser.tabs.get(tabId);

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
      return await browser.tabs.sendMessage(tabId, message);
    } catch (error) {
      console.error(`Failed to send message to tab ${tabId}:`, error);
      throw error;
    }
  }

  private async sendMessageToActiveTab(message: any) {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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
