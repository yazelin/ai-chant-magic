import { describe, it, expect } from 'vitest';
import { isValidAudioSize, sanitizePrompt, MAX_AUDIO_BYTES, MAX_PROMPT_CHARS } from '../src/validate';

describe('isValidAudioSize', () => {
  it('accepts a reasonable clip size', () => {
    expect(isValidAudioSize(50_000)).toBe(true);
  });
  it('rejects zero/empty', () => {
    expect(isValidAudioSize(0)).toBe(false);
  });
  it('rejects anything over the cap', () => {
    expect(isValidAudioSize(MAX_AUDIO_BYTES + 1)).toBe(false);
  });
  it('accepts exactly the cap', () => {
    expect(isValidAudioSize(MAX_AUDIO_BYTES)).toBe(true);
  });
});

describe('sanitizePrompt', () => {
  it('passes short prompts through unchanged', () => {
    expect(sanitizePrompt('黑暗,深淵,爆裂魔法')).toBe('黑暗,深淵,爆裂魔法');
  });
  it('truncates an overlong prompt instead of rejecting the whole request', () => {
    const long = 'x'.repeat(MAX_PROMPT_CHARS + 50);
    expect(sanitizePrompt(long).length).toBe(MAX_PROMPT_CHARS);
  });
  it('treats null/missing as an empty prompt', () => {
    expect(sanitizePrompt(null)).toBe('');
  });
});
