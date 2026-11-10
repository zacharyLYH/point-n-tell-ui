import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
