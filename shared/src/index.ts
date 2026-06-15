export * from './vec';
export * from './types';
export * from './config';
export * from './spells';
export * from './world';
export * from './matcher';
export * from './recognizer-policy';

// Both ./vec and ./matcher export a `normalize` (vector vs. text). The barrel
// surfaces the text normalizer; the vector one stays importable from './vec'.
export { normalize } from './matcher';
