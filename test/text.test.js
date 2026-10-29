import { describe, it, expect } from 'vitest';
import { joinUtterance, cleanTranscript } from '../src/lib/text.js';

describe('joinUtterance', () => {
  it('capitalizes at the start of a field', () => {
    expect(joinUtterance('', 'hello there.')).toBe('Hello there.');
  });
  it('adds a space and capitalizes after a sentence', () => {
    expect(joinUtterance('First one.', 'second one.')).toBe(' Second one.');
  });
  it('does not double spaces', () => {
    expect(joinUtterance('First one. ', 'Second.')).toBe('Second.');
  });
  it('lowercases a continuation mid-sentence', () => {
    expect(joinUtterance('I went to the', 'Store today.')).toBe(' store today.');
    expect(joinUtterance('Well,', 'Maybe.')).toBe(' maybe.');
  });
  it('keeps I, acronyms and names mid-sentence', () => {
    expect(joinUtterance('and then', "I left.")).toBe(' I left.');
    expect(joinUtterance('and then', "I'm out.")).toBe(" I'm out.");
    expect(joinUtterance('ask', 'NASA why.')).toBe(' NASA why.');
  });
  it('treats a new line as a new block', () => {
    expect(joinUtterance('Line one\n', 'next line')).toBe('Next line');
  });
  it('does not put a space before punctuation', () => {
    expect(joinUtterance('Wait', '...')).toBe('...');
  });
  it('drops empty and noise-tag transcripts', () => {
    expect(joinUtterance('x', '  ')).toBe('');
    expect(joinUtterance('x', '[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript(' a \n b ')).toBe('a b');
  });
});
