import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync(new URL('./map_data_final.json', import.meta.url)));
const dataJson = JSON.stringify(data);

const template = readFileSync(new URL('./map_template.html', import.meta.url), 'utf8');
const out = template.replace('__DATA__', dataJson);
writeFileSync(new URL('./ubahn_map.html', import.meta.url), out);
console.log('written, bytes:', out.length);
