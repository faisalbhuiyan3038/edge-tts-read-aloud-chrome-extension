export interface Sentence {
  text: string;
  index: number;
  isHeading?: boolean;
}

export class TextProcessor {
  static splitIntoSentences(text: string): Sentence[] {
    // First normalize whitespace and remove extra spaces
    text = text.replace(/\s+/g, ' ').trim();

    // Split into sentences using a more robust regex that handles common abbreviations
    const sentenceRegex = /[^.!?]+(?:[.!?]+(?:(?=[A-Z][a-z])|$|\s))/g;
    const matches = text.match(sentenceRegex) || [];

    return matches
      .map((text, index) => {
        const trimmedText = text.trim();
        return {
          text: trimmedText,
          index,
          isHeading: TextProcessor.isHeading(trimmedText)
        };
      })
      .filter(sentence => sentence.text.length > 0);
  }

  static isHeading(text: string): boolean {
    return (
      // All caps with no lowercase
      /^[A-Z0-9\s.,!?-]+$/.test(text) ||
      // Short phrase ending with colon
      /^.{1,50}:$/.test(text) ||
      // Numbered heading
      /^\d+\.\s+.{1,50}$/.test(text)
    );
  }

  static extractTextContent(element: Element | HTMLElement | string): string {
    if (typeof element === 'string') {
      // If it's HTML string, parse it first
      if (element.trim().startsWith('<')) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(element, 'text/html');
        return TextProcessor.extractTextContent(doc.body);
      }
      // If it's plain text, return as is
      return element.trim();
    }

    let text = '';
    const walk = document.createTreeWalker(
      element,
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
      text += (node.textContent || '') + ' ';
    }
    return text.trim();
  }
}
