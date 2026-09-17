import { h } from '../dom.js';
import { t, register, onLangChange } from '../i18n.js';

register('en', {
  'Dein erster Entwurf': 'Your first design',
  'Die Bühne steht. Jetzt kommt dein Bild.': 'The stage is ready. Add your picture.',
  'Lade ein Video oder Bild und lege es auf eine Wand. Danach kannst du das Ergebnis als Video exportieren.':
    'Load a video or image and place it on a wall. Then export the result as a video.',
  'Dein Material ist da. Lege es auf eine Wand.': 'Your media are ready. Place them on a wall.',
  'In der Bibliothek eine Datei markieren, Wand und Slot wählen, dann „Platzieren“. Im Panel-Editor passt du den Ausschnitt an.':
    'Select a file in the library, choose a wall and slot, then click “Place”. Adjust its crop in the panel editor.',
  'Medien hinzufügen': 'Add media',
  'Wand gestalten': 'Design wall',
  'Video exportieren': 'Export video',
  'Bühne frei ansehen': 'Explore the stage',
});

/** Helpful only while the project has no placed layers; never changes the stage scene. */
export function createStartPanel({ onView }) {
  let state = null;
  let dismissed = false;
  let key = '';
  const el = h('aside.stage-start', { 'aria-label': t('Dein erster Entwurf') });
  const title = h('h2');
  const text = h('p');
  const mediaButton = h('button.btn.acc', { type: 'button', onClick: () => onView('library') });
  function mount() {
    el.setAttribute('aria-label', t('Dein erster Entwurf'));
    mediaButton.replaceChildren(h('span.stage-start-number', '1'), t('Medien hinzufügen'));
    el.replaceChildren(h('span.eyebrow', t('Dein erster Entwurf')), title, text,
      h('div.stage-start-actions', mediaButton,
        h('button.btn', { type: 'button', onClick: () => onView('editor') }, h('span.stage-start-number', '2'), t('Wand gestalten')),
        h('button.btn', { type: 'button', onClick: () => onView('render') }, h('span.stage-start-number', '3'), t('Video exportieren'))),
      h('button.stage-start-dismiss', { type: 'button', onClick: () => { dismissed = true; update(state); } }, t('Bühne frei ansehen')));
    key = '';
    update(state);
  }
  function update(next) {
    state = next;
    const placed = Object.values(state?.project?.walls || {}).some((wall) =>
      Object.values(wall.slots || {}).some((slot) => slot.layers?.length));
    const hasMedia = (state?.media?.length || 0) > 0;
    const nextKey = `${!!state?.project}|${placed}|${hasMedia}|${dismissed}`;
    if (nextKey === key) return;
    key = nextKey;
    el.hidden = !state?.project || placed || dismissed;
    title.textContent = t(hasMedia ? 'Dein Material ist da. Lege es auf eine Wand.' : 'Die Bühne steht. Jetzt kommt dein Bild.');
    text.textContent = t(hasMedia
      ? 'In der Bibliothek eine Datei markieren, Wand und Slot wählen, dann „Platzieren“. Im Panel-Editor passt du den Ausschnitt an.'
      : 'Lade ein Video oder Bild und lege es auf eine Wand. Danach kannst du das Ergebnis als Video exportieren.');
  }
  mount();
  onLangChange(mount);
  return { el, update };
}
