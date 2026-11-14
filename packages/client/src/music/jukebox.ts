// Options > Jukebox: plays any of the director's eighteen pieces from the soundtrack in use (the band book, or the
// modern view's), and loads a SoundFont for
// sampled instruments (kept for this visit; one placed at /generated/music/soundfont.sf2 loads every time).

import { dialog, el } from '../dialogs.js';
import { PIECES } from './director.js';
import type { Music } from './music.js';

export async function jukebox(music: Music): Promise<void> {
  await music.unlock();
  const list = el('select', { size: 10 } as Partial<HTMLSelectElement>);
  list.style.minWidth = '300px';
  PIECES.forEach((p, i) => {
    const def = music.piece(p.file);
    list.add(new Option(`${p.name}: ${def?.title ?? p.file}${p.start ? ` (${p.start})` : ''}`, String(i), i === 0, i === 0));
  });
  const credit = el('p', {});
  const showCredit = () => {
    const def = music.piece(PIECES[Number(list.value)]?.file ?? '');
    credit.textContent = def ? def.credit : '';
  };
  showCredit();
  list.addEventListener('change', showCredit);
  const play = el('button', { type: 'button', class: 'btn' }, 'Play');
  const stop = el('button', { type: 'button', class: 'btn' }, 'Stop');
  play.addEventListener('click', () => music.audition(Number(list.value)));
  list.addEventListener('dblclick', () => music.audition(Number(list.value)));
  stop.addEventListener('click', () => music.stopAudition());
  const sfName = el('span', {}, music.currentStyle === 'modern' ? 'Built-in rig (the modern soundtrack does not use a SoundFont)' : music.soundfont ?? 'Built-in band (MT-32 style)');
  const file = el('input', { type: 'file', accept: '.sf2' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      sfName.textContent = music.loadSoundFont(await f.arrayBuffer());
    } catch (err) {
      sfName.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  const body = el('div', { class: 'stack' }, list, credit, el('div', { class: 'buttons' }, play, stop),
    el('label', { class: 'field' }, el('span', {}, 'Instruments:'), sfName), el('label', { class: 'field' }, el('span', {}, 'SoundFont:'), file));
  await dialog('Jukebox', body, [['Close', 'ok']]);
  music.stopAudition();
}
