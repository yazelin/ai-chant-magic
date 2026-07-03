// A best-effort Simplified→Traditional safety net, NOT a full OpenCC-grade
// converter — this game's own vocabulary (spell names/aliases, reaction
// names, resonance keyword) is the primary/only thing that needs to survive
// intact, and every character below actually appears somewhere in it. The
// PRIMARY defense against Simplified drift is Groq's `prompt` hint (already-
// Traditional vocabulary biases the model's output style); this is just a
// cheap, deterministic backstop for whatever slips through, scoped to
// character-level (not whole-word) mapping so it also helps arbitrary
// player-customized chant words that reuse any of these characters.
const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = {
  术: '術', 风: '風', 线: '線', 锥: '錐', 绝: '絕', 冻: '凍', 结: '結',
  电: '電', 击: '擊', 闪: '閃', 连: '連', 锁: '鎖', 链: '鏈', 护: '護',
  恒: '恆', 疗: '療', 圣: '聖', 咏: '詠', 渊: '淵', 灵: '靈', 铁: '鐵',
  剑: '劍', 鸣: '鳴', 协: '協', 腾: '騰', 净: '淨',
};

export function traditionalize(text: string): string {
  let out = '';
  for (const ch of text) out += SIMPLIFIED_TO_TRADITIONAL[ch] ?? ch;
  return out;
}
