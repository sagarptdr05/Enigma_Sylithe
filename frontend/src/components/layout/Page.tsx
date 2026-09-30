import { motion } from "framer-motion";
import type { ReactNode } from "react";

export default function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.main
      initial={{ y: 12 }} animate={{ y: 0 }} exit={{ y: -8 }}
      transition={{ duration: 0.3 }} className={`mx-auto max-w-[1500px] px-4 py-6 ${className}`}>
      {children}
    </motion.main>
  );
}

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
