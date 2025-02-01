export class TextProcessor {
    static formatText(text: string): string {
      return text
        .replace(/\s+/g, ' ')
        .trim()
        .split(/[.!?]+/)
        .filter(sentence => sentence.length > 0)
        .join('. ');
    }
  }