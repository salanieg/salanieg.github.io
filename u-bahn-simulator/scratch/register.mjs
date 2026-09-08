import { register } from 'node:module';
register(new URL('./loader_hooks.mjs', import.meta.url));
