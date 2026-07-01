// A shareable/downloadable result card — drawn on a plain offscreen canvas
// (no Phaser), so it works from the gameover/victory banner independent of
// whether the game scene is still mounted. Content is deliberately simple
// (stats + roster, no screenshot) — the point is something worth bragging
// about, not a second renderer to maintain.
import { ClassId, CLASSES } from '@acm/shared';

export interface ShareCardPlayer {
  name: string;
  classId: ClassId;
}

export interface ShareCardStats {
  title: string; // e.g. "全破!四個世界都已淨化" / "無盡深淵・力竭倒下"
  statLine: string; // e.g. "第 4 波 · 擊殺 189 · 耗時 3:36"
  recordLine?: string; // optional gold accent line, e.g. "新紀錄!超越前次第 8 波"
  players: ShareCardPlayer[];
}

const CARD_W = 1200;
const CARD_H = 630;
const GAME_URL = 'yazelin.github.io/ai-chant-magic';

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function renderShareCard(stats: ShareCardStats): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#1b0f2a');
  bg.addColorStop(1, '#05030a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const accent = stats.players[0] ? CLASSES[stats.players[0].classId].color : '#ffd24d';
  const glow = ctx.createRadialGradient(CARD_W * 0.85, CARD_H * 0.15, 0, CARD_W * 0.85, CARD_H * 0.15, 520);
  glow.addColorStop(0, hexWithAlpha(accent, 0.35));
  glow.addColorStop(1, hexWithAlpha(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.strokeStyle = 'rgba(255,210,77,0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, CARD_W - 16, CARD_H - 16);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd24d';
  ctx.font = '800 32px system-ui, sans-serif';
  ctx.fillText('真．AI．咏唱魔法', 60, 88);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 52px system-ui, sans-serif';
  ctx.fillText(stats.title, 60, 190);

  ctx.fillStyle = '#c7cbdb';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText(stats.statLine, 60, 250);

  if (stats.recordLine) {
    ctx.fillStyle = '#ffd24d';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText(stats.recordLine, 60, 296);
  }

  const rosterY = 420;
  const slotW = (CARD_W - 120) / Math.max(1, stats.players.length);
  ctx.textAlign = 'center';
  stats.players.forEach((p, i) => {
    const cx = 60 + slotW * i + slotW / 2;
    const color = CLASSES[p.classId].color;
    ctx.beginPath();
    ctx.arc(cx, rosterY, 40, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#1a1030';
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(p.name.slice(0, 1).toUpperCase(), cx, rosterY + 11);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(truncate(p.name, 8), cx, rosterY + 66);
    ctx.fillStyle = '#9aa0b5';
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillText(CLASSES[p.classId].displayName, cx, rosterY + 90);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 18px system-ui, sans-serif';
  ctx.fillText('非官方同人二創・非商業作品', 60, CARD_H - 40);
  ctx.textAlign = 'right';
  ctx.fillText(GAME_URL, CARD_W - 60, CARD_H - 40);
  ctx.textAlign = 'left';

  return canvas;
}

// Web Share API (with a file attachment) when available — a one-tap share
// straight to any app on mobile; falls back to a plain PNG download.
export async function shareOrDownloadCard(
  canvas: HTMLCanvasElement,
  filename = 'ai-chant-magic-戰報.png',
): Promise<void> {
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: '真．AI．咏唱魔法 戰報', text: '來看看我的戰績!' });
      return;
    } catch {
      // user cancelled, or share failed for any reason — fall back to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
