export const springConfig = {
  default: { type: 'spring' as const, stiffness: 300, damping: 25, mass: 0.8 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 20, mass: 1 },
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 15, mass: 0.6 },
  stiff: { type: 'spring' as const, stiffness: 500, damping: 30, mass: 0.5 },
}

export const fadeInUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: springConfig.default,
}

export const scaleIn = {
  initial: { scale: 0.85, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: springConfig.default,
}

export const slideInRight = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
  transition: springConfig.default,
}

export const slideInLeft = {
  initial: { x: -20, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: -20, opacity: 0 },
  transition: springConfig.default,
}
