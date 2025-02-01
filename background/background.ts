

class BackgroundManager {
  constructor() {
    this.init();
  }

  private init() {
    // Clear existing menu items first
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'readSelection',
        title: 'Read this aloud',
        contexts: ['selection']
      });
    });

    this.setupListeners();
  }

  private setupListeners() {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === 'readSelection' && tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'readSelection',
          text: info.selectionText || '',
        });
      }
    });

    // Handle settings requests from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'getSettings') {
        chrome.storage.sync.get({
          voice: 'en-US-AvaNeural',
          speed: 1.0
        }, (settings) => {
          sendResponse(settings);
        });
        return true; // Keep channel open for async response
      }
    });
  }
}

new BackgroundManager();
