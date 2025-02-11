# Edge TTS Read Aloud Chrome Extension

A Chrome extension that provides high-quality text-to-speech using Microsoft Edge's TTS engine. This extension offers a clean reader view with synchronized text highlighting and precise sentence-level control.

## Features

- **High-Quality Text-to-Speech**: Uses Microsoft Edge's neural TTS engine for natural-sounding speech
- **Interactive Reader View**:
  - Clean, distraction-free reading interface
  - Click on any sentence to start reading from that point
  - Visual highlighting of the currently-read sentence
  - Automatic scrolling to keep the current sentence in view
- **Playback Controls**:
  - Play/Pause/Stop functionality
  - Resume from last position
  - Start reading from any sentence by clicking
- **Context Menu Integration**: Right-click on selected text to read it aloud
- **Voice Customization**:
  - Choose from multiple high-quality voices
  - Adjust reading speed
- **Synchronized Text Highlighting**: Visual feedback shows exactly which sentence is being read

## Demo

![Edge TTS Reader Screenshot](demo/Edge-TTS-Reader.png)

[Watch Extension Demo Video](https://www.youtube.com/watch?v=j8t5IHTXRNs)

**Note:** The audio appears low quality in the demo due to OBS recording issues but it's fine in a real browser.

## Usage

1. **Open Reader View**:
   - Click the extension icon to open the current page in reader view
   - The page will be cleaned up and formatted for optimal reading

2. **Start Reading**:
   - The extension will automatically start reading from the beginning
   - Click any sentence to start reading from that point
   - Use the control buttons to pause, resume, or stop reading

3. **Read Selected Text**:
   - Select any text on a webpage
   - Right-click and choose "Read Selection" from the context menu

4. **Customize Settings**:
   - Click the extension icon to access settings
   - Choose your preferred voice and reading speed

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory

## Technical Details

- Uses Edge TTS Client for high-quality text-to-speech
- Implements Mozilla's Readability for clean article extraction
- Maintains synchronized state between content script and reader view
- Processes text at sentence level for precise control
- Uses shared text processing logic for consistent sentence splitting

## Known Limitations

- The reader view presents content in a simplified format, focusing on readability over exact visual reproduction
- Some complex webpage layouts may be simplified in the reader view

## Contributing

Feel free to submit issues and pull requests for:
- Bug fixes
- New features
- Documentation improvements
- UI/UX enhancements
