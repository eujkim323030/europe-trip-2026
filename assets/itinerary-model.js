import { scheduleValid } from './schedule.js';
export const CITIES = ['helsinki', 'berlin', 'prague', 'vienna', 'budapest'];
export const CATEGORIES = ['', 'food', 'rest', 'shop', 'culture', 'spa', 'night'];
export const FIELDS = ['time', 'title', 'description', 'menu', 'cost', 'icon', 'category', 'mapLink'];

export function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeName === 'BR') return '\n';
  return Array.from(node.childNodes).map(textOf).join('').trim();
}

function readCard(element) {
  return {
    time: textOf(element.querySelector('.time')),
    title: textOf(element.querySelector('.title, .ctitle, h3')),
    description: textOf(element.querySelector('.desc, .cmeta, p')),
    menu: textOf(element.querySelector('.menu')),
    cost: textOf(element.querySelector('.cost, .ccost')),
    icon: textOf(element.querySelector('.icon')),
    category: CATEGORIES.find(c => c && element.classList.contains(c)) || '',
    mapLink: (element.matches('a') ? element : element.querySelector('a'))?.getAttribute('href') || '',
  };
}

export function extractItinerary(document, city) {
  const templates = new Map();
  const lanes = [];
  let index = 0;
  for (const timeline of document.querySelectorAll('.timeline')) {
    const day = timeline.closest('.day');
    const dayIndex = Array.from(document.querySelectorAll('.day')).indexOf(day) + 1;
    const option = timeline.closest('.option-panel')?.id.replace('panel-', '') || '';
    const id = `day-${dayIndex}${option ? '-' + option : ''}`;
    const label = textOf(day.querySelector('.day-title')) + (option ? ` · ${option.toUpperCase()}안` : '');
    timeline.dataset.lane = id;
    const items = [];
    let transport = [];
    let choiceTitle = '';
    for (const element of timeline.children) {
      if (element.classList.contains('transport')) {
        const small = element.querySelector('small')?.cloneNode(true);
        small?.querySelector('em')?.remove();
        transport.push({
          title: textOf(element.querySelector('b')) || textOf(element),
          description: textOf(small),
          mapLink: element.querySelector('a')?.getAttribute('href') || '',
        });
        continue;
      }
      if (element.classList.contains('choice-title')) {
        choiceTitle = textOf(element);
        continue;
      }
      const choices = element.classList.contains('choice-grid') || element.classList.contains('choice-wrap');
      if (!element.classList.contains('event') && !choices) throw new Error('Unknown timeline block');
      const itemId = `${city}-${++index}`;
      const item = {
        id: itemId, sourceId: itemId, kind: choices ? 'choices' : 'event',
        ...readCard(element), transport,
      };
      if (choices) {
        item.title = textOf(element.querySelector('.choice-title')) || choiceTitle;
        item.description = '';
        item.options = Array.from(element.querySelectorAll('.choice')).map(readCard);
      }
      templates.set(itemId, element.cloneNode(true));
      items.push(item);
      transport = [];
      choiceTitle = '';
    }
    if (transport.length) throw new Error('Unattached transport');
    lanes.push({ id, label, items });
  }
  return { data: { schema: 1, city, selectedOption: 'a', lanes }, templates };
}

export function moveItem(data, id, laneId, beforeId = null) {
  const source = data.lanes.find(lane => lane.items.some(item => item.id === id));
  const target = data.lanes.find(lane => lane.id === laneId);
  if (!source || !target || beforeId === id) return false;
  if (beforeId && !target.items.some(item => item.id === beforeId)) return false;
  const [item] = source.items.splice(source.items.findIndex(item => item.id === id), 1);
  target.items.splice(beforeId ? target.items.findIndex(item => item.id === beforeId) : target.items.length, 0, item);
  return true;
}

export function safeLink(value) {
  if (!value) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

export function validateItinerary(data, seed) {
  if (!data || data.schema !== 1 || data.city !== seed.city || !['a', 'b'].includes(data.selectedOption)) return false;
  if (!Array.isArray(data.lanes) || data.lanes.length !== seed.lanes.length) return false;
  const sources = new Map(seed.lanes.flatMap(l => l.items).map(item => [item.id, item]));
  const ids = new Set();
  let total = 0;
  const cardValid = card => card && FIELDS.every(field => typeof card[field] === 'string' && card[field].length <= ({description:4000,menu:2000,cost:500,mapLink:2000,time:80,title:300,icon:20,category:20}[field])) && CATEGORIES.includes(card.category) && safeLink(card.mapLink);
  for (let i = 0; i < data.lanes.length; i++) {
    const lane = data.lanes[i];
    if (lane.id !== seed.lanes[i].id || lane.label !== seed.lanes[i].label || !Array.isArray(lane.items)) return false;
    for (const item of lane.items) {
      if (++total > 250 || !cardValid(item) || !item.title.trim() || !scheduleValid(item.schedule)) return false;
      if (typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) return false;
      ids.add(item.id);
      if (!['event','choices'].includes(item.kind)) return false;
      if (item.sourceId !== null && (!sources.has(item.sourceId) || sources.get(item.sourceId).kind !== item.kind)) return false;
      if (!Array.isArray(item.transport) || item.transport.length > 5 || item.transport.some(t => !t || typeof t.title !== 'string' || t.title.length > 500 || typeof t.description !== 'string' || t.description.length > 4000 || typeof t.mapLink !== 'string' || t.mapLink.length > 2000 || !safeLink(t.mapLink))) return false;
      if (item.kind === 'choices' && (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 10 || item.options.some(c => !cardValid(c) || !c.title.trim()))) return false;
    }
  }
  return true;
}
