import { createContext, useContext } from "react";
import { useWindowDimensions } from "react-native";

/**
 * The space a page has: whether the side bar stands beside it, and how wide
 * the page is. Beside the side bar that is less than the window, which is all
 * a screen outside the navigator can measure.
 */
export interface Frame {
  wide: boolean;
  width: number;
}

const FrameContext = createContext<Frame | null>(null);

export const FrameProvider = FrameContext.Provider;

export function useFrame(): Frame {
  const given = useContext(FrameContext);
  const { width } = useWindowDimensions();
  return given ?? { wide: false, width };
}
