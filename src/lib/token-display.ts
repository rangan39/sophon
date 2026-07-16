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
