import { highlightParts } from '../lib/searchHighlight';

/**
 * Texto con la búsqueda resaltada (etiqueta <mark>). Sin query devuelve el
 * texto plano, para no envolver el título en spans de más.
 */
export default function HighlightedText({ text, query = '' }) {
  if (!query?.trim()) return text;
  return highlightParts(text, query).map((part, index) =>
    part.match ? (
      <mark key={index}>{part.text}</mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}
