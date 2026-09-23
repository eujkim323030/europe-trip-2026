import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { CITIES, extractItinerary } from '../assets/itinerary-model.js';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const seeds = {};
for (const city of CITIES) {
  const html = await readFile(`${city}/index.html`, 'utf8');
  seeds[city] = extractItinerary(parseHTML(html).document, city).data;
  await cp(city, `dist/${city}`, { recursive: true });
}
for (const path of ['index.html', 'manifest.webmanifest', 'assets']) await cp(path, `dist/${path}`, { recursive: true });
await mkdir('netlify/data', { recursive: true });
await writeFile('netlify/data/seeds.json', JSON.stringify(seeds));
console.log('Built five city pages and validated seed extraction');
