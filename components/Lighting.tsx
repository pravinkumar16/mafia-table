"use client";
import { motion } from "framer-motion";

/** Full-screen room lighting: warm amber lamp by day, cold moonlight by night. */
export default function Lighting({ night }: { night: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-ink">
      <motion.div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 35%, rgba(242,180,90,0.22), transparent 70%)" }}
        animate={{ opacity: night ? 0 : 1 }}
        transition={{ duration: 1.8, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 20%, rgba(91,141,239,0.25), transparent 70%), linear-gradient(180deg, rgba(10,18,40,0.85), rgba(5,8,18,0.95))",
        }}
        animate={{ opacity: night ? 1 : 0 }}
        transition={{ duration: 1.8, ease: "easeInOut" }}
      />
    </div>
  );
}
