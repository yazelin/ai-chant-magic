// Local best-record tracking for endless mode (client-only, no backend — the
// game has no account system). "Better" means: reached a later wave, or (tie
// on wave) a higher kill score. Solo and party runs are tracked separately
// since party runs naturally reach further waves (see CONFIG.endless scaling).
import type { ClassId } from '@acm/shared';

export type EndlessBucket = 'solo' | 'party';

export interface EndlessRecord {
  wave: number;
  score: number;
}

function recordKey(classId: ClassId, bucket: EndlessBucket): string {
  return `acm.endless.record.${classId}.${bucket}.v1`;
}

const UNLOCKED_KEY = 'acm.endless.unlocked';

export function loadRecord(classId: ClassId, bucket: EndlessBucket): EndlessRecord | null {
  try {
    const raw = localStorage.getItem(recordKey(classId, bucket));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const r = parsed as Partial<EndlessRecord>;
    if (typeof r?.wave === 'number' && typeof r?.score === 'number') return { wave: r.wave, score: r.score };
    return null;
  } catch {
    return null; // storage unavailable (private mode, SSR, quota) — best-effort only
  }
}

// Saves `candidate` as the new record if it's strictly better than whatever is
// stored. Returns whether it was saved (so the caller can show a "new record!"
// toast only when true).
export function saveRecordIfBetter(classId: ClassId, bucket: EndlessBucket, candidate: EndlessRecord): boolean {
  const current = loadRecord(classId, bucket);
  const better =
    !current || candidate.wave > current.wave || (candidate.wave === current.wave && candidate.score > current.score);
  if (better) {
    try {
      localStorage.setItem(recordKey(classId, bucket), JSON.stringify(candidate));
    } catch {
      /* best-effort only */
    }
  }
  return better;
}

export function isEndlessUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markEndlessUnlocked(): void {
  try {
    localStorage.setItem(UNLOCKED_KEY, '1');
  } catch {
    /* best-effort only */
  }
}
