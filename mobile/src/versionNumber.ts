/**
 * A version number on the row of its name. React Native wraps a text in a row
 * only when it may shrink, and an unreleased number with its words, such as
 * the German one, is wider than a phone's card.
 */
export const NUMBER_BESIDE_NAME = { flexShrink: 1, textAlign: "right" } as const;
