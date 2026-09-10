import { createContext, FC, PropsWithChildren, useContext, useMemo, useState } from "react"
import { Animated } from "react-native"

/**
 * How far the screen in front of you has scrolled.
 *
 * **One signal, two edges.** The pinned header's compact bar fades in when the
 * large title leaves, and the tab bar's top border is painted when content
 * starts passing beneath it. Both are the same question — *is there content
 * behind this edge* — and answering it twice from two sources is how they end
 * up disagreeing, one edge separated and the other not.
 *
 * It lives above the navigator because the tab bar is a sibling of every screen
 * and cannot reach into the one on top.
 *
 * A screen that never registers leaves the value at zero, which is the right
 * default: nothing has scrolled, so nothing is separated.
 */
type ScrollState = { scrollY: Animated.Value }

const ScrollCtx = createContext<ScrollState | null>(null)

export const ScrollProvider: FC<PropsWithChildren> = ({ children }) => {
  const [scrollY] = useState(() => new Animated.Value(0))
  const value = useMemo(() => ({ scrollY }), [scrollY])
  return <ScrollCtx.Provider value={value}>{children}</ScrollCtx.Provider>
}

/**
 * The shared offset, plus the props to spread onto a ScrollView.
 *
 * `useNativeDriver` is false because both borders are driven by JS-side
 * interpolation on this value; 16ms throttle keeps that to one update a frame
 * rather than one per scroll event.
 */
export function useScrollSignal() {
  const ctx = useContext(ScrollCtx)
  /* A screen rendered outside the provider still has to work — a fresh value
     that nothing reads is better than a crash on a screen that only scrolls. */
  const [fallback] = useState(() => new Animated.Value(0))
  const scrollY = ctx?.scrollY ?? fallback

  return {
    scrollY,
    scrollProps: {
      onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: false,
      }),
      scrollEventThrottle: 16,
      /* Leaving a stale offset behind would paint a border on a screen sitting
         at the top. Reset as each screen's list mounts. */
      onLayout: () => scrollY.setValue(0),
    },
  }
}
