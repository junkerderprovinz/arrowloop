// How a FieldRow names the control inside it.

import { createContext, useContext } from "react";

export const FieldRowContext = createContext<string | undefined>(undefined);
export const FieldRowGroupContext = createContext(false);

/** A control's accessible name: its own, or the label of the row it stands in. */
export function useFieldName(own: string | undefined): string | undefined {
  const row = useContext(FieldRowContext);
  return own ?? row;
}
