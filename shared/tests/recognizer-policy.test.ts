import { describe, it, expect } from 'vitest';
import {
  classifyError,
  classifyEnd,
  MAX_BAD_ENDS,
  IMMEDIATE_END_MS,
} from '../src/recognizer-policy';

describe('classifyError', () => {
  it('treats permission errors as fatal + denied', () => {
    expect(classifyError('not-allowed')).toMatchObject({ fatal: true, status: 'denied' });
    expect(classifyError('service-not-allowed')).toMatchObject({ fatal: true, status: 'denied' });
  });
  it('treats audio-capture and language errors as fatal', () => {
    expect(classifyError('audio-capture').fatal).toBe(true);
    expect(classifyError('language-not-supported').fatal).toBe(true);
  });
  it('treats network as non-fatal but error status', () => {
    expect(classifyError('network')).toMatchObject({ fatal: false, status: 'error' });
  });
  it('treats no-speech/aborted as benign (keep listening, no message)', () => {
    expect(classifyError('no-speech')).toMatchObject({ fatal: false, status: 'listening', message: '' });
    expect(classifyError('aborted')).toMatchObject({ fatal: false, status: 'listening', message: '' });
  });
});

describe('classifyEnd', () => {
  it('counts an immediate resultless end as bad', () => {
    const d = classifyEnd({ msSinceStart: 100, gotResultSinceStart: false, errorSinceStart: false, consecutiveBadEnds: 0 });
    expect(d.consecutiveBadEnds).toBe(1);
    expect(d.giveUp).toBe(false);
  });
  it('counts an end with an error as bad even if not immediate', () => {
    const d = classifyEnd({ msSinceStart: IMMEDIATE_END_MS + 500, gotResultSinceStart: false, errorSinceStart: true, consecutiveBadEnds: 1 });
    expect(d.consecutiveBadEnds).toBe(2);
  });
  it('resets the counter when a transcript was received', () => {
    const d = classifyEnd({ msSinceStart: 50, gotResultSinceStart: true, errorSinceStart: true, consecutiveBadEnds: 3 });
    expect(d.consecutiveBadEnds).toBe(0);
    expect(d.giveUp).toBe(false);
  });
  it('resets the counter for a long, error-free, resultless session', () => {
    // user simply did not speak — not a backend failure
    const d = classifyEnd({ msSinceStart: 5000, gotResultSinceStart: false, errorSinceStart: false, consecutiveBadEnds: 2 });
    expect(d.consecutiveBadEnds).toBe(0);
  });
  it('gives up after MAX_BAD_ENDS consecutive bad ends', () => {
    const d = classifyEnd({ msSinceStart: 50, gotResultSinceStart: false, errorSinceStart: true, consecutiveBadEnds: MAX_BAD_ENDS - 1 });
    expect(d.giveUp).toBe(true);
  });
});
