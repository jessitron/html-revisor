// The filesystem gateway: every read and write of a file. Tier III.
import fs from 'node:fs/promises';

export const readText = (file) => fs.readFile(file, 'utf8');
export const writeText = (file, text) => fs.writeFile(file, text);
