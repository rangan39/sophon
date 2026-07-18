export type TokenPiece = { id: number; text: string };
export type ContextTokenPiece = TokenPiece & { inContext?: boolean };
export type TokenWord = {
  text: string;
  tokenIndexes: number[];
  tokenIds: number[];
  inContext: boolean;
};

export function decodeTokenPieces(
  tokenIds: readonly number[],
  decode: (tokenIds: number[]) => string
): TokenPiece[] {
  return tokenIds.map((id) => ({ id, text: decode([id]) }));
}

export function markActiveContext<T extends TokenPiece>(tokens: readonly T[], activeStartIndex: number) {
  const firstActiveIndex = Math.max(0, activeStartIndex);
  return tokens.map((token, index) => ({
    ...token,
    inContext: index >= firstActiveIndex
  }));
}

/**
 * Returns the token fragments that overlap an exact character range in the
 * decoded source. Boundary tokens are clipped so the fragments still render
 * the same text as the message excerpt instead of leaking prompt scaffolding.
 */
export function sliceTokenPiecesByTextRange<T extends ContextTokenPiece>(
  tokens: readonly T[],
  sourceText: string,
  start: number,
  end: number
): ContextTokenPiece[] {
  if (start < 0 || end <= start || end > sourceText.length) return [];
  if (tokens.map((token) => token.text).join("") !== sourceText) return [];

  const result: ContextTokenPiece[] = [];
  let offset = 0;

  for (const token of tokens) {
    const tokenStart = offset;
    const tokenEnd = tokenStart + token.text.length;
    offset = tokenEnd;
    if (tokenEnd <= start || tokenStart >= end) continue;

    const fragmentStart = Math.max(start, tokenStart) - tokenStart;
    const fragmentEnd = Math.min(end, tokenEnd) - tokenStart;
    const text = token.text.slice(fragmentStart, fragmentEnd);
    if (text) result.push({ id: token.id, text, inContext: token.inContext });
  }

  return result;
}

export function groupTokenPieces(tokens: readonly ContextTokenPiece[]): TokenWord[] {
  const groups: TokenWord[] = [];

  tokens.forEach((token, index) => {
    const startsGroup = groups.length === 0 || /^\s/u.test(token.text);
    if (startsGroup) {
      groups.push({
        text: token.text,
        tokenIndexes: [index],
        tokenIds: [token.id],
        inContext: token.inContext !== false
      });
      return;
    }

    const group = groups.at(-1);
    if (!group) return;
    group.text += token.text;
    group.tokenIndexes.push(index);
    group.tokenIds.push(token.id);
    group.inContext = group.inContext && token.inContext !== false;
  });

  return groups;
}
