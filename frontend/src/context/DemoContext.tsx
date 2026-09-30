import { createContext, useContext, useState, type ReactNode } from "react";

interface DemoState { active: boolean; step: number; setActive: (v: boolean) => void; setStep: (n: number) => void }
const Ctx = createContext<DemoState>({ active: false, step: 0, setActive: () => {}, setStep: () => {} });

export function DemoProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  return <Ctx.Provider value={{ active, step, setActive, setStep }}>{children}</Ctx.Provider>;
}

export const useDemo = () => useContext(Ctx);
