// Spell chants are short (2-6 characters) — a few seconds of webm/opus is
// nowhere near this cap. Bounding it caps worst-case cost per request (Groq
// bills a 10s-audio minimum per call regardless of actual length, so a huge
// upload doesn't even buy more transcription, just more bandwidth/risk) and
// rejects obvious abuse attempts outright.
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_PROMPT_CHARS = 200;

export function isValidAudioSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_AUDIO_BYTES;
}

// Truncate rather than reject — a too-long prompt is a client bug/abuse
// attempt, not a reason to fail the whole transcription the player is
// actually waiting on.
export function sanitizePrompt(prompt: string | null): string {
  if (!prompt) return '';
  return prompt.slice(0, MAX_PROMPT_CHARS);
}
