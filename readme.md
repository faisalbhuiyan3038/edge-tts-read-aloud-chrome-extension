# Microsoft Edge Read Aloud Extension for Chrome

## What is this?
Ever wished you could have Microsoft Edge's premium text-to-speech voices in Chrome? Well, now you can! This extension brings the natural, high-quality read aloud voices from Microsoft Edge to any Chromium browser, completely free of charge.

## Features
- **Premium Voice Selection**: Choose from a variety of natural-sounding voices offered by Microsoft Edge's text-to-speech service.
- **Smart Text Detection**: Advanced algorithms to accurately detect and parse readable content, even in complex web layouts.
- **Context Menu Integration**: Simply select any text and right-click to start reading - perfect for quick snippets!
- **Customizable Experience**: Adjust playback speed to match your reading preferences.
- **Cross-Browser Compatibility**: Works seamlessly across different Chromium browsers, including Arc browser where many other extensions fail.

## Technical Challenges & Solutions

### Text Parsing
One of the biggest challenges was accurately extracting readable content from web pages. We implemented multiple approaches:

1. **Mozilla's Readability**: Leveraged the battle-tested Readability library for main article content extraction.
2. **Custom TreeWalker**: Implemented a sophisticated DOM traversal system to handle dynamic content and complex layouts.
3. **Smart Content Filtering**: Built-in filters to exclude irrelevant elements like scripts, styles, and hidden content.

### Audio Streaming
The extension uses a custom implementation of Microsoft Edge's TTS service:
- Efficient audio chunk processing for smooth playback
- Real-time audio streaming with minimal latency
- Robust error handling and recovery mechanisms

### Browser Compatibility
We tackled various browser-specific challenges:
- Implemented custom content detection for Arc browser
- Built a robust audio context management system
- Designed a flexible message passing system between extension components

## Future Improvements
- Interactive text view with click-to-read functionality
- Enhanced text parsing for complex layouts
- Visual feedback for current reading position
- Support for more text sources and formats

## Installation
Due to Chrome Web Store's developer registration fee requirements, this extension is currently not available there. However, you can easily install it manually:

1. Go to the [Releases](https://github.com/faisalbhuiyan3038/edge-tts-read-aloud-chrome-extension/releases) page
2. Download the latest `.zip` file
3. Extract the zip file to a folder on your computer
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable "Developer mode" in the top right corner
6. Click "Load unpacked" and select the folder where you extracted the zip
7. The extension should now appear in your browser toolbar!

Note: Since this is a developer mode installation, you might see a warning about using developer mode extensions. This is normal and you can safely keep the extension.

## Credits
This extension was built using [edge-tts-client](https://github.com/travisvn/edge-tts-client) by [@travisvn](https://github.com/travisvn). Their excellent work on the TTS client made this extension possible.

## Contributing
Found a bug or have a feature request? Feel free to open an issue or submit a pull request!
