// Joins a transcribed utterance onto the text already before the caret, so
// consecutive utterances read as one passage.

const CLOSING_PUNCT = /^[.,!?;:%)\]}'"’”…]/;
const SENTENCE_END = /[.!?…]["'’”)\]]*\s*$/;

export function cleanTranscript(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim()
    // Models sometimes emit these for silence or noise.
    .replace(/^\[?(blank_audio|silence|music|inaudible)\]?$/i, '')
    .replace(/^\((?:silence|music|inaudible)\)$/i, '');
}

export function joinUtterance(before, text) {
  text = cleanTranscript(text);
  if (!text) return '';

  const prior = before.replace(/[ \t]+$/, '');
  const startOfBlock = prior === '' || /\n$/.test(prior);

  if (startOfBlock || SENTENCE_END.test(prior)) {
    text = text[0].toUpperCase() + text.slice(1);
  } else if (/[,;:]$/.test(prior) || /[a-z0-9]$/i.test(prior)) {
    // Mid-sentence: models capitalize every utterance, undo that unless the
    // word looks like a proper noun or acronym ("I", "NASA").
    const first = text.split(' ')[0];
    if (/^[A-Z][a-z]/.test(first) && first !== 'I' && !/^I'/.test(first)) {
      text = text[0].toLowerCase() + text.slice(1);
    }
  }

  const needsSpace = before !== '' && !/\s$/.test(before) && !CLOSING_PUNCT.test(text);
  return (needsSpace ? ' ' : '') + text;
}
