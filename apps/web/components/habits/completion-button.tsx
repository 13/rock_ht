"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CompletionButtonProps {
  completed: boolean;
  color: string;
  onToggle: () => void;
  disabled?: boolean;
  size?: "sm" | "default" | "lg";
}

const sizes = {
  sm: "h-7 w-7",
  default: "h-9 w-9",
  lg: "h-11 w-11",
};

const iconSizes = {
  sm: "h-3.5 w-3.5",
  default: "h-4 w-4",
  lg: "h-5 w-5",
};

export function CompletionButton({
  completed,
  color,
  onToggle,
  disabled = false,
  size = "default",
}: CompletionButtonProps) {
  return (
    <motion.button
      onClick={onToggle}
      disabled={disabled}
      whileTap={{ scale: 0.88 }}
      className={cn(
        "relative rounded-full border-2 flex items-center justify-center shrink-0",
        "transition-colors duration-200 outline-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        sizes[size]
      )}
      style={
        completed
          ? {
              backgroundColor: color,
              borderColor: color,
            }
          : {
              backgroundColor: "transparent",
              borderColor: color,
            }
      }
      aria-label={completed ? "Mark incomplete" : "Mark complete"}
    >
      <AnimatePresence mode="wait">
        {completed && (
          <motion.div
            key="check"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 25 }}
          >
            <Check className={cn("text-white", iconSizes[size])} strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ripple on completion */}
      <AnimatePresence>
        {completed && (
          <motion.div
            key="ripple"
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: color }}
            initial={{ scale: 1, opacity: 0.4 }}
            animate={{ scale: 2.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}
